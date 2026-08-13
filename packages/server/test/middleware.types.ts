import type { Address } from "viem";

import type {
  PaymentMiddlewareOptions,
  PaymentVerifier,
  ReceiptClient,
  ReplayStore,
} from "../src/index.js";

declare const publicClient: ReceiptClient;
declare const replayStore: ReplayStore;
declare const verifier: PaymentVerifier;

const common = {
  priceUsdc: "0.01",
  payTo: "0x1111111111111111111111111111111111111111" as Address,
  chainId: 84532 as const,
};

const rpcOptions: PaymentMiddlewareOptions = {
  ...common,
  rpcUrl: "https://rpc.example",
};
const publicClientOptions: PaymentMiddlewareOptions = {
  ...common,
  publicClient,
};
const verifierOptions: PaymentMiddlewareOptions = {
  ...common,
  verifier,
};

// @ts-expect-error A ready-made verifier cannot be combined with an RPC URL.
const verifierWithRpc: PaymentMiddlewareOptions = {
  ...common,
  verifier,
  rpcUrl: "https://rpc.example",
};
// @ts-expect-error A ready-made verifier cannot be combined with a public client.
const verifierWithClient: PaymentMiddlewareOptions = { ...common, verifier, publicClient };
// @ts-expect-error A ready-made verifier cannot accept verifier-construction options.
const verifierWithConfirmations: PaymentMiddlewareOptions = { ...common, verifier, confirmations: 2 };
// @ts-expect-error A ready-made verifier cannot accept verifier-construction options.
const verifierWithUsdcAddress: PaymentMiddlewareOptions = {
  ...common,
  verifier,
  usdcAddress: common.payTo,
};
// @ts-expect-error A ready-made verifier cannot accept verifier-construction options.
const verifierWithReplayStore: PaymentMiddlewareOptions = { ...common, verifier, replayStore };
// @ts-expect-error RPC URL and public client branches are mutually exclusive.
const rpcWithClient: PaymentMiddlewareOptions = {
  ...common,
  rpcUrl: "https://rpc.example",
  publicClient,
};

void [
  rpcOptions,
  publicClientOptions,
  verifierOptions,
  verifierWithRpc,
  verifierWithClient,
  verifierWithConfirmations,
  verifierWithUsdcAddress,
  verifierWithReplayStore,
  rpcWithClient,
];
