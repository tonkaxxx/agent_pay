import type { RequestHandler } from "express";
import {
  type Address,
  createPublicClient,
  http,
} from "viem";
import { base, baseSepolia } from "viem/chains";

import {
  assertSupportedChainId,
  createPaymentVerifier,
  type PaymentRequirements,
  type PaymentVerifier,
  type ReceiptClient,
  type ReplayStore,
  type SupportedChainId,
  validatePaymentRequirements,
} from "./verifier.js";

export const PAYMENT_HEADER = "X-Payment-Tx";

export interface PaymentRequiredPayload extends PaymentRequirements {
  error: "Payment Required";
  network: "base" | "base-sepolia";
}

interface CommonPaymentMiddlewareOptions extends PaymentRequirements {}

interface VerifierConstructionOptions {
  /** Optional token override for dependency injection/testing; defaults to official chain USDC. */
  usdcAddress?: Address;
  confirmations?: number;
  replayStore?: ReplayStore;
}

interface RpcPaymentMiddlewareOptions
  extends CommonPaymentMiddlewareOptions, VerifierConstructionOptions {
  rpcUrl: string;
  publicClient?: never;
  verifier?: never;
}

interface PublicClientPaymentMiddlewareOptions
  extends CommonPaymentMiddlewareOptions, VerifierConstructionOptions {
  rpcUrl?: never;
  publicClient: ReceiptClient;
  verifier?: never;
}

interface ReadyMadeVerifierPaymentMiddlewareOptions extends CommonPaymentMiddlewareOptions {
  verifier: PaymentVerifier;
  rpcUrl?: never;
  publicClient?: never;
  usdcAddress?: never;
  confirmations?: never;
  replayStore?: never;
}

export type PaymentMiddlewareOptions =
  | RpcPaymentMiddlewareOptions
  | PublicClientPaymentMiddlewareOptions
  | ReadyMadeVerifierPaymentMiddlewareOptions;

const chainConfigurations = {
  8453: { chain: base, network: "base" },
  84532: { chain: baseSepolia, network: "base-sepolia" },
} as const satisfies Record<
  SupportedChainId,
  { chain: typeof base | typeof baseSepolia; network: PaymentRequiredPayload["network"] }
>;

function assertRpcUrl(rpcUrl: unknown): asserts rpcUrl is string {
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new Error("rpcUrl must be a non-empty HTTP(S) URL");
  }

  try {
    const url = new URL(rpcUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") {
      throw new Error();
    }
  } catch {
    throw new Error("rpcUrl must be a non-empty HTTP(S) URL");
  }
}

function clientFor(
  options: RpcPaymentMiddlewareOptions | PublicClientPaymentMiddlewareOptions,
): ReceiptClient {
  if ("publicClient" in options) return options.publicClient;

  assertRpcUrl(options.rpcUrl);
  return createPublicClient({
    chain: chainConfigurations[options.chainId].chain,
    transport: http(options.rpcUrl),
  }) as ReceiptClient;
}

export function paymentMiddleware(options: PaymentMiddlewareOptions): RequestHandler {
  assertSupportedChainId(options.chainId);
  validatePaymentRequirements(options);
  const chainConfiguration = chainConfigurations[options.chainId];
  const payload: PaymentRequiredPayload = {
    error: "Payment Required",
    priceUsdc: options.priceUsdc,
    payTo: options.payTo,
    network: chainConfiguration.network,
    chainId: options.chainId,
  };
  let verify: PaymentVerifier;
  if ("verifier" in options) {
    if (typeof options.verifier !== "function") {
      throw new Error("verifier must be a function");
    }
    verify = options.verifier;
  } else {
    verify = createPaymentVerifier({
      requirements: {
        priceUsdc: options.priceUsdc,
        payTo: options.payTo,
        chainId: options.chainId,
      },
      publicClient: clientFor(options),
      ...(options.usdcAddress === undefined ? {} : { usdcAddress: options.usdcAddress }),
      ...(options.confirmations === undefined ? {} : { confirmations: options.confirmations }),
      ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
    });
  }

  return async (request, response, next) => {
    const txHash = request.get(PAYMENT_HEADER);
    if (!txHash) {
      response.status(402).json(payload);
      return;
    }

    let result;
    try {
      result = await verify(txHash);
    } catch {
      response.status(503).json({
        error: "Payment Verification Unavailable",
        reason: "verification_unavailable",
      });
      return;
    }
    if (result.valid) {
      next();
      return;
    }

    if (result.retryable) {
      response.status(503).json({
        error: "Payment Verification Unavailable",
        reason: result.reason,
      });
      return;
    }

    response.status(403).json({ error: "Invalid Payment", reason: result.reason });
  };
}
