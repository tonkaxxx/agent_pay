import "dotenv/config";

import express from "express";
import { pathToFileURL } from "node:url";

import { paymentMiddleware } from "@x402/server";

import {
  DEMO_PRICE_USDC,
  assertMainnetAllowed,
  loadDemoEnvironment,
  modeFromArguments,
  type DemoEnvironment,
  type DemoNetwork,
} from "./demo-config.js";

type Address = `0x${string}`;

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
  args: readonly string[],
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): DemoEnvironment {
  const config = loadDemoEnvironment(modeFromArguments(args), env);
  if (config.network.realFunds) assertMainnetAllowed(env);
  return config;
}

function main(): void {
  const config = vendorRuntimeConfiguration(process.argv.slice(2), process.env);
  const app = createVendorApp(config);
  const onListening = () => {
    if (config.network.realFunds) {
      console.log("BASE MAINNET / REAL FUNDS");
    }
    console.log(`Vendor API: http://${config.network.realFunds ? "127.0.0.1" : "localhost"}:${config.port}/api/data`);
    console.log(`Price: ${DEMO_PRICE_USDC} USDC`);
    console.log(`Recipient: ${config.vendorWalletAddress}`);
    if (config.network.realFunds) {
      console.log("Replay store: in-memory only");
      console.log("Refunds: unavailable");
    }
  };

  if (config.network.realFunds) {
    app.listen(config.port, "127.0.0.1", onListening);
  } else {
    app.listen(config.port, onListening);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start Vendor API.");
    process.exitCode = 1;
  }
}
