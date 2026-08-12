import { getAddress, type Address, type Hex } from "viem";

import { USDC_BASE, USDC_BASE_SEPOLIA, type AgentPayNetwork } from "@agentpay/server";

export const DEMO_PRICE_USDC = "0.01";

export type DemoMode = "sepolia" | "mainnet";

export interface DemoNetwork {
  readonly mode: DemoMode;
  readonly chainId: 8453 | 84532;
  readonly network: AgentPayNetwork;
  readonly rpcEnvironmentName: "BASE_MAINNET_RPC_URL" | "BASE_SEPOLIA_RPC_URL";
  readonly usdcAddress: Address;
  readonly explorerUrl: string;
  readonly realFunds: boolean;
}

export const DEMO_NETWORKS: Readonly<Record<DemoMode, DemoNetwork>> = {
  sepolia: {
    mode: "sepolia",
    chainId: 84532,
    network: "eip155:84532",
    rpcEnvironmentName: "BASE_SEPOLIA_RPC_URL",
    usdcAddress: USDC_BASE_SEPOLIA,
    explorerUrl: "https://sepolia-explorer.base.org",
    realFunds: false,
  },
  mainnet: {
    mode: "mainnet",
    chainId: 8453,
    network: "eip155:8453",
    rpcEnvironmentName: "BASE_MAINNET_RPC_URL",
    usdcAddress: USDC_BASE,
    explorerUrl: "https://base.blockscout.com",
    realFunds: true,
  },
};

export interface DemoEnvironment {
  readonly network: DemoNetwork;
  readonly rpcUrl: string;
  readonly vendorWalletAddress: Address;
  readonly port: number;
  readonly mainnetAllowed: boolean;
}

type Environment = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export function executeRequested(args: readonly string[]): boolean {
  return args.includes("--execute");
}

export function loadDemoEnvironment(mode: DemoMode, env: Environment): DemoEnvironment {
  const network = DEMO_NETWORKS[mode];
  const rpcUrl = validatedRpcUrl(
    requiredEnvironment(network.rpcEnvironmentName, env),
    network.rpcEnvironmentName,
  );

  return {
    network,
    rpcUrl,
    vendorWalletAddress: validatedVendorWalletAddress(
      requiredEnvironment("VENDOR_WALLET_ADDRESS", env),
    ),
    port: portFromEnvironment(env),
    mainnetAllowed: env.ALLOW_MAINNET_PAYMENTS === "true",
  };
}

export function validatedPrivateKey(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[\da-fA-F]{64}$/.test(value)) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hexadecimal private key.");
  }
  return value as Hex;
}

export function vendorApiUrlFromEnvironment(config: DemoEnvironment, env: Environment): string {
  const value = env.VENDOR_API_URL ?? "http://localhost:3000/api/data";
  const url = validatedUrl(value, "VENDOR_API_URL");

  if (config.network.realFunds) {
    const expected = `http://127.0.0.1:${config.port}/api/data`;
    if (url.href !== expected || url.username !== "" || url.password !== ""
      || url.search !== "" || url.hash !== "") {
      throw new Error(`VENDOR_API_URL must be exactly ${expected}.`);
    }
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VENDOR_API_URL must use HTTP or HTTPS.");
  }

  return url.href;
}

export function assertMainnetAllowed(env: Environment): void {
  if (env.ALLOW_MAINNET_PAYMENTS !== "true") {
    throw new Error("ALLOW_MAINNET_PAYMENTS must be exactly true for mainnet payments.");
  }
}

function requiredEnvironment(name: string, env: Environment): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function validatedRpcUrl(value: string, environmentName: DemoNetwork["rpcEnvironmentName"]): string {
  const url = validatedUrl(value, environmentName);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${environmentName} must use HTTP or HTTPS.`);
  }
  return url.href;
}

function validatedVendorWalletAddress(value: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error("VENDOR_WALLET_ADDRESS must be a 20-byte hexadecimal address.");
  }
}

function validatedUrl(value: string, environmentName: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${environmentName} must be a valid URL.`);
  }
}

function portFromEnvironment(env: Environment): number {
  const value = env.PORT ?? "3000";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}
