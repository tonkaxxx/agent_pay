import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type FeeMode = "ledger" | "custodial";
type Environment = Readonly<Record<string, string | undefined>>;

export type GatewayFinanceConfig =
  | { readonly mode: "ledger" }
  | { readonly mode: "custodial"; readonly collectionAddress: Address };

export interface PayoutWorkerConfig {
  readonly databaseUrl: string;
  readonly rpcUrl: string;
  readonly privateKey: Hex;
  readonly collectionAddress: Address;
  readonly feeRecipient: Address;
}

function configurationError(variable: string): Error {
  return new Error(`Invalid finance configuration: ${variable}`);
}

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw configurationError(name);
  }
  return value.trim();
}

function address(value: string | undefined, name: string): Address {
  try {
    return getAddress(value ?? "");
  } catch {
    throw configurationError(name);
  }
}

function httpUrl(value: string | undefined, name: string): string {
  try {
    const url = new URL(value ?? "");
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw configurationError(name);
    }
    return url.href;
  } catch {
    throw configurationError(name);
  }
}

function databaseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw configurationError("DATABASE_URL");
    }
    return url.href;
  } catch {
    throw configurationError("DATABASE_URL");
  }
}

function privateKey(value: string | undefined): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw configurationError("AGENTPAY_PAYOUT_PRIVATE_KEY");
  }
  return value.toLowerCase() as Hex;
}

function requireLegalApproval(environment: Environment): void {
  if (environment.AGENTPAY_CUSTODY_LEGAL_APPROVED !== "true") {
    throw configurationError("AGENTPAY_CUSTODY_LEGAL_APPROVED");
  }
}

export function loadGatewayFinanceConfig(environment: Environment): GatewayFinanceConfig {
  const mode = environment.AGENTPAY_FEE_MODE?.trim() || "ledger";
  if (mode === "ledger") return { mode };
  if (mode !== "custodial") throw configurationError("AGENTPAY_FEE_MODE");
  requireLegalApproval(environment);
  return {
    mode,
    collectionAddress: address(
      environment.AGENTPAY_GATEWAY_COLLECTION_ADDRESS,
      "AGENTPAY_GATEWAY_COLLECTION_ADDRESS",
    ),
  };
}

export function loadPayoutWorkerConfig(environment: Environment): PayoutWorkerConfig {
  requireLegalApproval(environment);
  if (environment.AGENT_PRIVATE_KEY !== undefined) {
    throw configurationError("AGENT_PRIVATE_KEY");
  }
  const payoutKey = privateKey(environment.AGENTPAY_PAYOUT_PRIVATE_KEY);
  if (environment.FACILITATOR_PRIVATE_KEY?.toLowerCase() === payoutKey) {
    throw configurationError("FACILITATOR_PRIVATE_KEY");
  }
  const collectionAddress = address(
    environment.AGENTPAY_GATEWAY_COLLECTION_ADDRESS,
    "AGENTPAY_GATEWAY_COLLECTION_ADDRESS",
  );
  if (privateKeyToAccount(payoutKey).address !== collectionAddress) {
    throw configurationError("AGENTPAY_GATEWAY_COLLECTION_ADDRESS");
  }
  const feeRecipient = address(environment.AGENTPAY_FEE_RECIPIENT, "AGENTPAY_FEE_RECIPIENT");
  if (feeRecipient === collectionAddress) {
    throw configurationError("AGENTPAY_FEE_RECIPIENT");
  }
  return {
    databaseUrl: databaseUrl(required(environment, "DATABASE_URL")),
    rpcUrl: httpUrl(environment.BASE_MAINNET_RPC_URL, "BASE_MAINNET_RPC_URL"),
    privateKey: payoutKey,
    collectionAddress,
    feeRecipient,
  };
}
