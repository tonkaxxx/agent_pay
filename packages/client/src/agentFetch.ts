import {
  getAddress,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type ProtocolErrorCode =
  | "invalid_payment_response"
  | "unsupported_chain"
  | "network_mismatch"
  | "payment_limit_exceeded";

export type PaymentErrorCode =
  | "rpc_chain_mismatch"
  | "transfer_failed"
  | "transaction_failed";

export class X402ProtocolError extends Error {
  constructor(
    public readonly code: ProtocolErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "X402ProtocolError";
  }
}

export class X402PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "X402PaymentError";
  }
}

export interface AgentFetchConfig {
  privateKey: Hex;
  rpcUrl: string;
  maxPaymentUsdc?: string;
  confirmations?: number;
}

export type AgentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PaymentRuntime {
  getChainId(): Promise<number>;
  transferUsdc(input: { token: Address; to: Address; amount: bigint }): Promise<Hash>;
  waitForReceipt(
    hash: Hash,
    confirmations: number,
  ): Promise<{ status: "success" | "reverted" }>;
}

export interface AgentFetchDependencies {
  fetch: typeof globalThis.fetch;
  createPaymentRuntime(input: {
    privateKey: Hex;
    rpcUrl: string;
    chainId: 8453 | 84532;
  }): PaymentRuntime;
}

type SupportedChainId = 8453 | 84532;
type BaseNetwork = "base" | "base-sepolia";

const baseNetworks: Readonly<Record<SupportedChainId, BaseNetwork>> = {
  8453: "base",
  84532: "base-sepolia",
};
const usdcPricePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

const defaultDependencies: AgentFetchDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  createPaymentRuntime: () => {
    throw new X402PaymentError(
      "transfer_failed",
      "Payment runtime is not available until payment execution is configured.",
    );
  },
};

function parsePositiveUsdc(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !usdcPricePattern.test(value)) return undefined;

  const amount = parseUnits(value, 6);
  return amount > 0n ? amount : undefined;
}

function validateConfig(config: AgentFetchConfig): { cap: bigint } {
  privateKeyToAccount(config.privateKey);

  let rpcUrl: URL;
  try {
    rpcUrl = new URL(config.rpcUrl);
  } catch {
    throw new TypeError("rpcUrl must be a valid HTTP(S) URL.");
  }
  if (rpcUrl.protocol !== "http:" && rpcUrl.protocol !== "https:") {
    throw new TypeError("rpcUrl must use HTTP or HTTPS.");
  }

  const cap = parsePositiveUsdc(config.maxPaymentUsdc ?? "1.00");
  if (cap === undefined) throw new RangeError("maxPaymentUsdc must be a positive USDC amount.");

  const confirmations = config.confirmations ?? 1;
  if (!Number.isInteger(confirmations) || confirmations <= 0) {
    throw new RangeError("confirmations must be a positive integer.");
  }

  return { cap };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError(
  code: ProtocolErrorCode,
  message: string,
  options?: ErrorOptions,
): X402ProtocolError {
  return new X402ProtocolError(code, message, options);
}

function validatePaymentRequirement(value: unknown, cap: bigint): void {
  if (!isRecord(value)
    || value.error !== "Payment Required"
    || typeof value.priceUsdc !== "string"
    || typeof value.payTo !== "string"
    || typeof value.network !== "string"
    || typeof value.chainId !== "number") {
    throw protocolError("invalid_payment_response", "Invalid HTTP 402 payment response.");
  }

  let payTo: Address;
  try {
    payTo = getAddress(value.payTo);
  } catch (cause) {
    throw protocolError("invalid_payment_response", "Invalid HTTP 402 payment recipient.", { cause });
  }
  void payTo;

  if (value.chainId !== 8453 && value.chainId !== 84532) {
    throw protocolError("unsupported_chain", "HTTP 402 payment response specifies an unsupported chain.");
  }

  if (value.network !== baseNetworks[value.chainId]) {
    throw protocolError("network_mismatch", "HTTP 402 payment response network does not match its chain.");
  }

  const price = parsePositiveUsdc(value.priceUsdc);
  if (price === undefined) {
    throw protocolError("invalid_payment_response", "HTTP 402 payment response has an invalid USDC price.");
  }
  if (price > cap) {
    throw protocolError("payment_limit_exceeded", "HTTP 402 payment exceeds maxPaymentUsdc.");
  }
}

async function paymentRequirementFrom(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch (cause) {
    throw protocolError("invalid_payment_response", "HTTP 402 payment response is not valid JSON.", { cause });
  }
}

export function createAgentFetch(
  config: AgentFetchConfig,
  dependencies: AgentFetchDependencies = defaultDependencies,
): AgentFetch {
  const { cap } = validateConfig(config);

  return async (input, init) => {
    const request = new Request(input, init);
    const response = await dependencies.fetch(request.clone());
    if (response.status !== 402) return response;

    validatePaymentRequirement(await paymentRequirementFrom(response), cap);
    return response;
  };
}
