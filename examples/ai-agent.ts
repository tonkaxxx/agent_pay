import "dotenv/config";

import { createAgentFetch } from "@x402/client";

type Hex = `0x${string}`;

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

function validatedPrivateKey(value: string): Hex {
  if (!/^0x[\da-fA-F]{64}$/.test(value)) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hexadecimal private key.");
  }
  return value as Hex;
}

async function main(): Promise<void> {
  const privateKey = validatedPrivateKey(requiredEnvironment("AGENT_PRIVATE_KEY"));
  const rpcUrl = validatedRpcUrl(requiredEnvironment("BASE_SEPOLIA_RPC_URL"));
  const vendorApiUrl = process.env.VENDOR_API_URL ?? "http://localhost:3000/api/data";
  const agentFetch = createAgentFetch({
    privateKey,
    rpcUrl,
    maxPaymentUsdc: "0.10",
  });

  const response = await agentFetch(vendorApiUrl);
  if (!response.ok) {
    throw new Error(`Vendor API request failed with HTTP ${response.status}.`);
  }

  console.log(`Vendor API status: ${response.status}`);
  console.log(await response.json());
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent request failed.");
  process.exitCode = 1;
});
