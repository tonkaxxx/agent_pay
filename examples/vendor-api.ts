import "dotenv/config";

import express from "express";
import { pathToFileURL } from "node:url";

import { paymentMiddleware } from "@x402/server";

type Address = `0x${string}`;

export function createVendorApp(config: {
  vendorWalletAddress: Address;
  rpcUrl: string;
}) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: "0.01",
      payTo: config.vendorWalletAddress,
      chainId: 84532,
      rpcUrl: config.rpcUrl,
    }),
    (_request, response) => response.json({
      data: "The paid signal is 42.",
      paidWith: "USDC",
      network: "base-sepolia",
    }),
  );
  return app;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function validatedRpcUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BASE_SEPOLIA_RPC_URL must use HTTP or HTTPS.");
  }
  return url.href;
}

function validatedAddress(value: string): Address {
  if (!/^0x[\da-fA-F]{40}$/.test(value)) {
    throw new Error("VENDOR_WALLET_ADDRESS must be a 20-byte hexadecimal address.");
  }
  return value as Address;
}

function portFromEnvironment(): number {
  const value = process.env.PORT ?? "3000";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function main(): void {
  const vendorWalletAddress = validatedAddress(requiredEnvironment("VENDOR_WALLET_ADDRESS"));
  const rpcUrl = validatedRpcUrl(requiredEnvironment("BASE_SEPOLIA_RPC_URL"));
  const port = portFromEnvironment();
  const app = createVendorApp({ vendorWalletAddress, rpcUrl });

  app.listen(port, () => {
    console.log(`Vendor API: http://localhost:${port}/api/data`);
    console.log("Price: 0.01 USDC");
    console.log(`Recipient: ${vendorWalletAddress}`);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start Vendor API.");
    process.exitCode = 1;
  }
}
