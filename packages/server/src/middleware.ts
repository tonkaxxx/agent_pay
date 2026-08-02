import type { RequestHandler } from "express";
import {
  type Address,
  createPublicClient,
  http,
} from "viem";
import { base, baseSepolia } from "viem/chains";

import {
  createPaymentVerifier,
  type PaymentRequirements,
  type ReceiptClient,
  type ReplayStore,
} from "./verifier.js";

export const PAYMENT_HEADER = "X-Payment-Tx";

export interface PaymentRequiredPayload extends PaymentRequirements {
  error: "Payment Required";
  network: "base" | "base-sepolia";
}

interface CommonPaymentMiddlewareOptions extends PaymentRequirements {
  /** Reserved for applications that need to record the payment token address. */
  usdcAddress?: Address;
  confirmations?: number;
  replayStore?: ReplayStore;
}

interface RpcPaymentMiddlewareOptions extends CommonPaymentMiddlewareOptions {
  rpcUrl: string;
  publicClient?: never;
}

interface PublicClientPaymentMiddlewareOptions extends CommonPaymentMiddlewareOptions {
  rpcUrl?: never;
  publicClient: ReceiptClient;
}

export type PaymentMiddlewareOptions =
  | RpcPaymentMiddlewareOptions
  | PublicClientPaymentMiddlewareOptions;

function clientFor(options: PaymentMiddlewareOptions): ReceiptClient {
  if ("publicClient" in options) return options.publicClient;

  return createPublicClient({
    chain: options.chainId === 8453 ? base : baseSepolia,
    transport: http(options.rpcUrl),
  }) as ReceiptClient;
}

export function paymentMiddleware(options: PaymentMiddlewareOptions): RequestHandler {
  const payload: PaymentRequiredPayload = {
    error: "Payment Required",
    priceUsdc: options.priceUsdc,
    payTo: options.payTo,
    network: options.chainId === 8453 ? "base" : "base-sepolia",
    chainId: options.chainId,
  };
  const verify = createPaymentVerifier({
    requirements: {
      priceUsdc: options.priceUsdc,
      payTo: options.payTo,
      chainId: options.chainId,
    },
    publicClient: clientFor(options),
    ...(options.confirmations === undefined ? {} : { confirmations: options.confirmations }),
    ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
  });

  return async (request, response, next) => {
    const txHash = request.get(PAYMENT_HEADER);
    if (!txHash) {
      response.status(402).json(payload);
      return;
    }

    const result = await verify(txHash);
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
