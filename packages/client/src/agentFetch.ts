import { x402Client, type PaymentCreationContext, type PaymentResponseContext } from "@x402/core/client";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
import {
  appendPaymentIdentifierToExtensions,
  generatePaymentId,
  isValidPaymentId,
  PAYMENT_IDENTIFIER,
} from "@x402/extensions/payment-identifier";
import { wrapFetchWithPayment } from "@x402/fetch";
import { formatUnits, getAddress, parseUnits, type Address } from "viem";

export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_BASE_SEPOLIA: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export type AgentPayNetwork = "eip155:8453" | "eip155:84532";
export type PaymentChainId = 8453 | 84532;
export type PaymentNetwork = AgentPayNetwork;

export type ProtocolErrorCode =
  | "invalid_payment_response"
  | "unsupported_network"
  | "unsupported_scheme"
  | "unsupported_asset"
  | "payment_limit_exceeded"
  | "payment_not_authorized";

export type PaymentErrorCode =
  | "payment_creation_failed"
  | "payment_verification_failed"
  | "payment_settlement_failed"
  | "payment_failed";

export type PaymentFailureStage = "parse" | "policy" | "sign" | "verify" | "settle" | "error";

export interface PaymentAuthorizationContext {
  readonly requestUrl: string;
  readonly paymentId: string;
  readonly scheme: "exact";
  readonly network: AgentPayNetwork;
  readonly chainId: PaymentChainId;
  readonly recipient: Address;
  readonly token: Address;
  readonly priceUsdc: string;
  readonly amount: bigint;
}

export type PaymentEvent =
  | { readonly type: "payment_required"; readonly context: PaymentAuthorizationContext }
  | { readonly type: "payment_authorized"; readonly context: PaymentAuthorizationContext }
  | {
    readonly type: "payment_settled";
    readonly context: PaymentAuthorizationContext;
    readonly transaction: string;
  }
  | {
    readonly type: "payment_failed";
    readonly requestUrl: string;
    readonly paymentId?: string;
    readonly stage: PaymentFailureStage;
    readonly error: Error;
  };

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
    public readonly stage: PaymentFailureStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "X402PaymentError";
  }
}

export interface AgentFetchConfig {
  readonly signer: ClientEvmSigner;
  readonly networks: readonly [AgentPayNetwork, ...AgentPayNetwork[]];
  readonly maxPaymentUsdc: string;
  readonly authorizePayment?: (
    context: PaymentAuthorizationContext,
  ) => boolean | Promise<boolean>;
  readonly paymentIdFactory?: (request: Request) => string;
  readonly onPaymentEvent?: (event: PaymentEvent) => void | Promise<void>;
}

export type AgentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface AgentFetchDependencies {
  readonly fetch: typeof globalThis.fetch;
}

const defaultDependencies: AgentFetchDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
};

const usdcPricePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const networkDetails: Readonly<Record<AgentPayNetwork, {
  chainId: PaymentChainId;
  token: Address;
}>> = {
  "eip155:8453": { chainId: 8453, token: USDC_BASE },
  "eip155:84532": { chainId: 84532, token: USDC_BASE_SEPOLIA },
};

function positiveUsdc(value: string, field: string): bigint {
  if (!usdcPricePattern.test(value)) {
    throw new RangeError(`${field} must be a positive USDC amount with at most six decimals.`);
  }
  const amount = parseUnits(value, 6);
  if (amount <= 0n) {
    throw new RangeError(`${field} must be greater than zero.`);
  }
  return amount;
}

function validateConfig(config: AgentFetchConfig): { cap: bigint; networks: AgentPayNetwork[] } {
  if (!config.signer || typeof config.signer.signTypedData !== "function") {
    throw new TypeError("signer must implement ClientEvmSigner.");
  }
  try {
    getAddress(config.signer.address);
  } catch (cause) {
    throw new TypeError("signer.address must be a valid EVM address.", { cause });
  }

  if (!Array.isArray(config.networks) || config.networks.length === 0) {
    throw new RangeError("networks must contain at least one supported CAIP-2 network.");
  }
  const networks: AgentPayNetwork[] = [];
  for (const network of config.networks) {
    if (!(network in networkDetails)) {
      throw new RangeError(`Unsupported AgentPay network: ${String(network)}.`);
    }
    if (!networks.includes(network)) networks.push(network);
  }

  return { cap: positiveUsdc(config.maxPaymentUsdc, "maxPaymentUsdc"), networks };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function protocolError(
  code: ProtocolErrorCode,
  message: string,
  options?: ErrorOptions,
): X402ProtocolError {
  return new X402ProtocolError(code, message, options);
}

function authorizationContext(
  requestUrl: string,
  paymentId: string,
  selected: PaymentRequirements,
): PaymentAuthorizationContext {
  if (selected.scheme !== "exact") {
    throw protocolError("unsupported_scheme", "AgentPay only authorizes the x402 exact scheme.");
  }
  if (!(selected.network in networkDetails)) {
    throw protocolError("unsupported_network", `Unsupported x402 network: ${selected.network}.`);
  }
  const network = selected.network as AgentPayNetwork;
  const { chainId, token } = networkDetails[network];

  let asset: Address;
  let recipient: Address;
  try {
    asset = getAddress(selected.asset);
    recipient = getAddress(selected.payTo);
  } catch (cause) {
    throw protocolError(
      "invalid_payment_response",
      "The x402 payment requirement contains an invalid EVM address.",
      { cause },
    );
  }
  if (asset !== token) {
    throw protocolError(
      "unsupported_asset",
      `AgentPay only supports official USDC on ${network}.`,
    );
  }

  let amount: bigint;
  try {
    amount = BigInt(selected.amount);
  } catch (cause) {
    throw protocolError(
      "invalid_payment_response",
      "The x402 payment requirement contains an invalid amount.",
      { cause },
    );
  }
  if (amount <= 0n) {
    throw protocolError("invalid_payment_response", "The x402 payment amount must be positive.");
  }
  return {
    requestUrl,
    paymentId,
    scheme: "exact",
    network,
    chainId,
    recipient,
    token,
    priceUsdc: formatUnits(amount, 6),
    amount,
  };
}

function paymentErrorFor(stage: PaymentFailureStage, cause: Error): X402PaymentError {
  const code: PaymentErrorCode = stage === "verify"
    ? "payment_verification_failed"
    : stage === "settle"
      ? "payment_settlement_failed"
      : stage === "sign"
        ? "payment_creation_failed"
        : "payment_failed";
  return new X402PaymentError(code, stage, `x402 payment failed during ${stage}.`, { cause });
}

export function createAgentFetch(
  config: AgentFetchConfig,
  dependencies: AgentFetchDependencies = defaultDependencies,
): AgentFetch {
  const { cap, networks } = validateConfig(config);

  const emit = async (event: PaymentEvent): Promise<void> => {
    try {
      await config.onPaymentEvent?.(event);
    } catch {
      // Observability is intentionally best-effort and must never change payment behavior.
    }
  };

  return async (input, init) => {
    const request = new Request(input, init);
    let stage: PaymentFailureStage = "error";
    let paymentId: string | undefined;
    let context: PaymentAuthorizationContext | undefined;
    let terminalError: Error | undefined;
    let failureReported = false;

    const reportFailure = async (error: Error, failedStage = stage): Promise<void> => {
      if (failureReported) return;
      failureReported = true;
      await emit({
        type: "payment_failed",
        requestUrl: request.url,
        ...(paymentId === undefined ? {} : { paymentId }),
        stage: failedStage,
        error,
      });
    };

    const client = new x402Client();
    for (const network of networks) {
      client.register(network, new ExactEvmScheme(config.signer));
    }

    client.onBeforePaymentCreation(async ({ selectedRequirements }: PaymentCreationContext) => {
      stage = "parse";
      try {
        paymentId ??= config.paymentIdFactory?.(request.clone()) ?? generatePaymentId();
        if (!isValidPaymentId(paymentId)) {
          throw protocolError(
            "invalid_payment_response",
            "paymentIdFactory returned an invalid Payment Identifier.",
          );
        }
        context = authorizationContext(request.url, paymentId, selectedRequirements);
      } catch (error) {
        terminalError = asError(error);
        await reportFailure(terminalError, "parse");
        throw terminalError;
      }

      await emit({ type: "payment_required", context });
      stage = "policy";
      if (context.amount > cap) {
        terminalError = protocolError(
          "payment_limit_exceeded",
          "The x402 payment exceeds maxPaymentUsdc.",
        );
        await reportFailure(terminalError, "policy");
        throw terminalError;
      }
      if (config.authorizePayment !== undefined) {
        let authorized: boolean;
        try {
          authorized = await config.authorizePayment(context);
        } catch (cause) {
          terminalError = protocolError(
            "payment_not_authorized",
            "x402 payment authorization failed closed.",
            { cause },
          );
          await reportFailure(terminalError, "policy");
          throw terminalError;
        }
        if (!authorized) {
          terminalError = protocolError(
            "payment_not_authorized",
            "x402 payment was not authorized.",
          );
          await reportFailure(terminalError, "policy");
          throw terminalError;
        }
      }

      await emit({ type: "payment_authorized", context });
      stage = "sign";
    });

    client.registerExtension({
      key: PAYMENT_IDENTIFIER,
      enrichPaymentPayload: async (payload: PaymentPayload) => {
        if (paymentId === undefined) return payload;
        const extensions = payload.extensions ?? {};
        appendPaymentIdentifierToExtensions(extensions, paymentId);
        return { ...payload, extensions };
      },
    });

    client.onPaymentCreationFailure(async ({ error }) => {
      terminalError = paymentErrorFor("sign", error);
      await reportFailure(terminalError, "sign");
    });

    client.onAfterPaymentCreation(async () => {
      stage = "verify";
    });

    client.onPaymentResponse(async (result: PaymentResponseContext) => {
      if (result.settleResponse?.success) {
        stage = "settle";
        if (context !== undefined) {
          await emit({
            type: "payment_settled",
            context,
            transaction: result.settleResponse.transaction,
          });
        }
        return;
      }

      const failedStage: PaymentFailureStage = result.paymentRequired
        ? "verify"
        : result.settleResponse
          ? "settle"
          : "error";
      const error = result.error ?? new Error(
        result.settleResponse?.errorMessage
          ?? result.settleResponse?.errorReason
          ?? result.paymentRequired?.error
          ?? `Paid request did not include a successful PAYMENT-RESPONSE header.`,
      );
      await reportFailure(error, failedStage);
    });

    try {
      const trackedFetch: typeof globalThis.fetch = async (...args) => {
        const response = await dependencies.fetch(...args);
        if (stage === "error" && response.status === 402) stage = "parse";
        return response;
      };
      const fetchWithPayment = wrapFetchWithPayment(trackedFetch, client);
      return await fetchWithPayment(request.clone());
    } catch (error) {
      const cause = terminalError ?? asError(error);
      await reportFailure(cause);
      if (terminalError !== undefined) throw terminalError;
      if (cause instanceof X402ProtocolError || cause instanceof X402PaymentError) throw cause;
      throw paymentErrorFor(stage, cause);
    }
  };
}
