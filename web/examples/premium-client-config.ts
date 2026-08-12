import { getAddress, type Address, type Hex } from "viem";

import { USDC_BASE, type PaymentAuthorizationContext } from "@agentpay/client";

type Environment = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export interface PremiumClientConfig {
  readonly privateKey: Hex;
  readonly apiUrl: string;
  readonly expectedPayTo: Address;
  readonly mainnetAllowed: boolean;
}

export function executeRequested(args: readonly string[]): boolean {
  return args.includes("--execute");
}

export function loadPremiumClientConfig(env: Environment): PremiumClientConfig {
  const privateKey = required("AGENT_PRIVATE_KEY", env);
  if (!/^0x[\da-fA-F]{64}$/.test(privateKey)) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hexadecimal private key.");
  }

  return {
    privateKey: privateKey as Hex,
    apiUrl: httpUrl(required("AGENTPAY_API_URL", env), "AGENTPAY_API_URL"),
    expectedPayTo: address(required("AGENTPAY_EXPECTED_PAY_TO", env)),
    mainnetAllowed: env.ALLOW_MAINNET_PAYMENTS === "true",
  };
}

export function authorizePremiumPayment(
  payment: PaymentAuthorizationContext,
  config: PremiumClientConfig,
  shouldExecute: boolean,
  log: (message: string) => void,
): boolean {
  if (payment.requestUrl !== config.apiUrl) {
    throw new Error("Payment request URL does not match AGENTPAY_API_URL.");
  }
  if (payment.chainId !== 8453) throw new Error("Payment chain must be Base Mainnet (8453).");
  if (payment.network !== "eip155:8453") throw new Error("Payment network must be eip155:8453.");
  if (payment.recipient !== config.expectedPayTo) {
    throw new Error("Payment recipient does not match AGENTPAY_EXPECTED_PAY_TO.");
  }
  if (payment.token !== USDC_BASE) {
    throw new Error("Payment token must be the official Base USDC contract.");
  }
  if (payment.priceUsdc !== "0.01") throw new Error("Payment price must be exactly 0.01 USDC.");
  if (payment.amount !== 10_000n) {
    throw new Error("Payment amount must be exactly 10000 USDC base units.");
  }

  log("BASE MAINNET / REAL FUNDS");
  log(`Vendor URL: ${payment.requestUrl}`);
  log(`Chain ID: ${payment.chainId}`);
  log(`Recipient: ${payment.recipient}`);
  log(`USDC token: ${payment.token}`);
  log(`Price: ${payment.priceUsdc} USDC (${payment.amount} base units)`);

  if (!shouldExecute) {
    log("PAYMENT NOT SENT");
    return false;
  }
  if (!config.mainnetAllowed) {
    throw new Error(
      "ALLOW_MAINNET_PAYMENTS must be exactly true to authorize a Base Mainnet payment.",
    );
  }
  return true;
}

function required(name: string, env: Environment): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${name} must not contain credentials.`);
  }
  return url.href;
}

function address(value: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error("AGENTPAY_EXPECTED_PAY_TO must be a 20-byte hexadecimal address.");
  }
}
