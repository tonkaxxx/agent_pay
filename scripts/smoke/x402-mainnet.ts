import { pathToFileURL } from "node:url";

import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { isAddressEqual, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_API_URL = "https://agentpay.thebestsites.ru/api/premium";
const BASE_NETWORK = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AGENTPAY_PAY_TO = "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB";
const MAX_AMOUNT = 10_000n;
const MAX_TIMEOUT_SECONDS = 300;

export interface PaymentPreview {
  resource: string;
  network: typeof BASE_NETWORK;
  amount: "10000";
  amountUsdc: "0.01";
  asset: typeof BASE_USDC;
  payTo: typeof AGENTPAY_PAY_TO;
  maxTimeoutSeconds: number;
}

function policyRejected(): never {
  throw new Error("payment_policy_rejected");
}

function canonicalApiUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      return policyRejected();
    }
    if (url.username || url.password || url.search || url.hash) return policyRejected();
    return url.href;
  } catch {
    return policyRejected();
  }
}

export function validatePaymentRequired(encoded: string, apiUrl: string): PaymentPreview {
  try {
    const expectedResource = canonicalApiUrl(apiUrl);
    const paymentRequired = decodePaymentRequiredHeader(encoded);
    if (paymentRequired.x402Version !== 2 || paymentRequired.resource.url !== expectedResource) {
      return policyRejected();
    }
    if (paymentRequired.accepts.length !== 1) return policyRejected();
    if (Object.keys(paymentRequired.extensions ?? {}).length !== 0) return policyRejected();

    const accepted = paymentRequired.accepts[0];
    if (!accepted ||
      accepted.scheme !== "exact" ||
      accepted.network !== BASE_NETWORK ||
      BigInt(accepted.amount) !== MAX_AMOUNT ||
      !isAddressEqual(accepted.asset as `0x${string}`, BASE_USDC) ||
      !isAddressEqual(accepted.payTo as `0x${string}`, AGENTPAY_PAY_TO) ||
      !Number.isSafeInteger(accepted.maxTimeoutSeconds) ||
      accepted.maxTimeoutSeconds < 1 ||
      accepted.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
      return policyRejected();
    }

    return {
      resource: expectedResource,
      network: BASE_NETWORK,
      amount: "10000",
      amountUsdc: "0.01",
      asset: BASE_USDC,
      payTo: AGENTPAY_PAY_TO,
      maxTimeoutSeconds: accepted.maxTimeoutSeconds,
    };
  } catch {
    return policyRejected();
  }
}

function privateKey(environment: NodeJS.ProcessEnv): Hex {
  const value = environment.AGENT_PRIVATE_KEY;
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error("AGENT_PRIVATE_KEY_invalid");
  }
  return value as Hex;
}

async function preview(apiUrl: string): Promise<PaymentPreview> {
  const response = await fetch(apiUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    redirect: "error",
  });
  if (response.status !== 402) throw new Error("payment_preview_failed");
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) throw new Error("payment_preview_failed");
  return validatePaymentRequired(header, apiUrl);
}

export async function runSmoke(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const apiUrl = canonicalApiUrl(environment.API_URL ?? DEFAULT_API_URL);
  const payment = await preview(apiUrl);
  process.stdout.write(`${JSON.stringify({ mode: "preview", payment })}\n`);

  const execute = args.includes("--execute");
  if (!execute || environment.ALLOW_MAINNET_PAYMENTS !== "true") {
    process.stdout.write("PAYMENT NOT SENT\n");
    return;
  }

  const signer = privateKeyToAccount(privateKey(environment));
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const response = await fetchWithPayment(apiUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) throw new Error("paid_request_failed");

  const encodedSettlement = response.headers.get("PAYMENT-RESPONSE");
  if (!encodedSettlement) throw new Error("settlement_response_missing");
  const settlement = decodePaymentResponseHeader(encodedSettlement);
  if (!settlement.success || !settlement.transaction) {
    throw new Error("settlement_failed");
  }
  const data: unknown = await response.json();
  process.stdout.write(`${JSON.stringify({
    status: response.status,
    transaction: settlement.transaction,
    data,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSmoke(process.argv.slice(2), process.env).catch(() => {
    process.stderr.write("AgentPay x402 smoke failed\n");
    process.exitCode = 1;
  });
}
