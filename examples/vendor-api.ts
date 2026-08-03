import "dotenv/config";

import express from "express";
import { pathToFileURL } from "node:url";

import { paymentMiddleware } from "@x402/server";

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
  rpcUrl: string;
  network: DemoNetwork;
}) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: DEMO_PRICE_USDC,
      payTo: config.vendorWalletAddress,
      chainId: config.network.chainId,
      rpcUrl: config.rpcUrl,
    }),
    (_request, response) => response.json({
      data: "The paid signal is 42.",
      paidWith: "USDC",
      network: config.network.network,
    }),
  );
  return app;
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
      log("Replay store: in-memory only");
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
  startVendorApp(config, createVendorApp(config), console.log);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start Vendor API.");
    process.exitCode = 1;
  }
}
