import "dotenv/config";

import express from "express";
import { pathToFileURL } from "node:url";

import { createFacilitatorConfig } from "@coinbase/x402";
import {
  HTTPFacilitatorClient,
  createAgentPayResourceServer,
  createAgentPayRoute,
  paymentMiddleware,
  type FacilitatorClient,
} from "@agentpay/server";

import {
  DEMO_PRICE_USDC,
  assertMainnetAllowed,
  loadDemoEnvironment,
  type DemoEnvironment,
  type DemoMode,
  type DemoNetwork,
} from "./demo-config.js";

type Address = `0x${string}`;

interface VendorAppServer {
  listen(port: number, callback: () => void): unknown;
  listen(port: number, hostname: string, callback: () => void): unknown;
}

export function createVendorApp(config: {
  vendorWalletAddress: Address;
  network: DemoNetwork;
}, facilitator: FacilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
})) {
  const app = express();
  const server = createAgentPayResourceServer({
    facilitator,
    networks: [config.network.network],
  });
  const route = createAgentPayRoute({
    network: config.network.network,
    priceUsdc: DEMO_PRICE_USDC,
    payTo: config.vendorWalletAddress,
    description: "AgentPay premium data demo",
    mimeType: "application/json",
    paymentIdentifier: "optional",
    discovery: { outputExample: { data: "Here is your premium data" } },
  });
  app.get(
    "/api/data",
    paymentMiddleware({ "GET /api/data": route }, server),
    (_request, response) => response.json({
      data: "Here is your premium data",
      paidWith: "USDC",
      network: config.network.network,
    }),
  );
  return app;
}

export function createVendorFacilitator(
  mode: DemoMode,
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): FacilitatorClient {
  if (mode === "sepolia") {
    return new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
  }
  const apiKeyId = env.CDP_API_KEY_ID;
  const apiKeySecret = env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET must be set for mainnet.");
  }
  return new HTTPFacilitatorClient(createFacilitatorConfig(apiKeyId, apiKeySecret));
}

export function vendorRuntimeConfiguration(
  mode: DemoMode,
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): DemoEnvironment {
  const config = loadDemoEnvironment(mode, env);
  if (config.network.realFunds) assertMainnetAllowed(env);
  return config;
}

export function defaultVendorRuntimeConfiguration(
  _args: readonly string[],
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): DemoEnvironment {
  return vendorRuntimeConfiguration("sepolia", env);
}

export function startVendorApp(
  config: DemoEnvironment,
  app: VendorAppServer,
  log: (message: string) => void,
): void {
  const onListening = () => {
    if (config.network.realFunds) {
      log("BASE MAINNET / REAL FUNDS");
    }
    log(`Vendor API: http://${config.network.realFunds ? "127.0.0.1" : "localhost"}:${config.port}/api/data`);
    log(`Price: ${DEMO_PRICE_USDC} USDC`);
    log(`Recipient: ${config.vendorWalletAddress}`);
    if (config.network.realFunds) {
      log("Idempotency store: in-memory only");
      log("Refunds: unavailable");
    }
  };

  if (config.network.realFunds) {
    app.listen(config.port, "127.0.0.1", onListening);
  } else {
    app.listen(config.port, onListening);
  }
}

function main(): void {
  const config = defaultVendorRuntimeConfiguration(process.argv.slice(2), process.env);
  startVendorApp(config, createVendorApp(config, createVendorFacilitator("sepolia", process.env)), console.log);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start Vendor API.");
    process.exitCode = 1;
  }
}
