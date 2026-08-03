import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

export type ProtocolErrorCode =
  | "invalid_payment_response"
  | "unsupported_chain"
  | "network_mismatch"
  | "payment_limit_exceeded"
  | "payment_not_authorized";

export type PaymentChainId = 8453 | 84532;
export type PaymentNetwork = "base" | "base-sepolia";

export interface PaymentAuthorizationContext {
  readonly requestUrl: string;
  readonly chainId: PaymentChainId;
  readonly network: PaymentNetwork;
  readonly payTo: Address;
  readonly token: Address;
  readonly priceUsdc: string;
  readonly amount: bigint;
}

export interface PaymentTransactionContext {
  readonly hash: Hash;
  readonly chainId: PaymentChainId;
  readonly token: Address;
  readonly payTo: Address;
  readonly amount: bigint;
}

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
  authorizePayment?: (
    context: PaymentAuthorizationContext,
  ) => boolean | Promise<boolean>;
  onTransactionSubmitted?: (
    context: PaymentTransactionContext,
  ) => void | Promise<void>;
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
    chainId: PaymentChainId;
  }): PaymentRuntime;
}

export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_BASE_SEPOLIA: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const baseNetworks: Readonly<Record<PaymentChainId, PaymentNetwork>> = {
  8453: "base",
  84532: "base-sepolia",
};
const usdcAddresses: Readonly<Record<PaymentChainId, Address>> = {
  8453: USDC_BASE,
  84532: USDC_BASE_SEPOLIA,
};
const transferAbi = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
]);
const usdcPricePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const PAYMENT_HEADER = "X-Payment-Tx";

const defaultDependencies: AgentFetchDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  createPaymentRuntime: ({ privateKey, rpcUrl, chainId }) => {
    const chain = chainId === 8453 ? base : baseSepolia;
    const account = privateKeyToAccount(privateKey);
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    return {
      getChainId: () => publicClient.getChainId(),
      transferUsdc: ({ token, to, amount }) => walletClient.writeContract({
        address: token,
        abi: transferAbi,
        functionName: "transfer",
        args: [to, amount],
      }),
      waitForReceipt: async (hash, confirmations) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations });
        return { status: receipt.status };
      },
    };
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

interface PaymentRequirement {
  chainId: PaymentChainId;
  network: PaymentNetwork;
  payTo: Address;
  priceUsdc: string;
  amount: bigint;
}

function validatePaymentRequirement(value: unknown, cap: bigint): PaymentRequirement {
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

  return {
    chainId: value.chainId,
    network: value.network,
    payTo,
    priceUsdc: value.priceUsdc,
    amount: price,
  };
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
  const confirmations = config.confirmations ?? 1;

  return async (input, init) => {
    const request = new Request(input, init);
    const response = await dependencies.fetch(request.clone());
    if (response.status !== 402) return response;

    const requirement = validatePaymentRequirement(await paymentRequirementFrom(response), cap);
    const token = usdcAddresses[requirement.chainId];
    const authorizationContext: PaymentAuthorizationContext = {
      requestUrl: request.url,
      chainId: requirement.chainId,
      network: requirement.network,
      payTo: requirement.payTo,
      token,
      priceUsdc: requirement.priceUsdc,
      amount: requirement.amount,
    };

    if (config.authorizePayment !== undefined) {
      let authorized: boolean;
      try {
        authorized = await config.authorizePayment(authorizationContext);
      } catch (cause) {
        throw protocolError(
          "payment_not_authorized",
          "HTTP 402 payment authorization failed.",
          { cause },
        );
      }
      if (!authorized) {
        throw protocolError(
          "payment_not_authorized",
          "HTTP 402 payment was not authorized.",
        );
      }
    }

    const runtime = dependencies.createPaymentRuntime({
      privateKey: config.privateKey,
      rpcUrl: config.rpcUrl,
      chainId: requirement.chainId,
    });

    let rpcChainId: number;
    try {
      rpcChainId = await runtime.getChainId();
    } catch (cause) {
      throw new X402PaymentError("transfer_failed", "Could not determine the RPC chain ID.", { cause });
    }
    if (rpcChainId !== requirement.chainId) {
      throw new X402PaymentError("rpc_chain_mismatch", "RPC chain ID does not match the payment requirement.");
    }

    let hash: Hash;
    try {
      hash = await runtime.transferUsdc({
        token,
        to: requirement.payTo,
        amount: requirement.amount,
      });
    } catch (cause) {
      throw new X402PaymentError("transfer_failed", "USDC transfer failed.", { cause });
    }

    if (config.onTransactionSubmitted !== undefined) {
      try {
        await config.onTransactionSubmitted({
          hash,
          chainId: requirement.chainId,
          token,
          payTo: requirement.payTo,
          amount: requirement.amount,
        });
      } catch {
        // Observability must not interrupt confirmation after funds were submitted.
      }
    }

    let receipt: { status: "success" | "reverted" };
    try {
      receipt = await runtime.waitForReceipt(hash, confirmations);
    } catch (cause) {
      throw new X402PaymentError("transfer_failed", "USDC transfer confirmation failed.", { cause });
    }
    if (receipt.status === "reverted") {
      throw new X402PaymentError("transaction_failed", "USDC transfer transaction reverted.");
    }

    const retryRequest = request.clone();
    const retryHeaders = new Headers(retryRequest.headers);
    retryHeaders.set(PAYMENT_HEADER, hash);
    return dependencies.fetch(new Request(retryRequest, { headers: retryHeaders }));
  };
}
