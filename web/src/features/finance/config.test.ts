import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { loadGatewayFinanceConfig, loadPayoutWorkerConfig } from "./config";

const PAYOUT_KEY = `0x${"1".padStart(64, "0")}` as const;
const COLLECTION = privateKeyToAccount(PAYOUT_KEY).address;
const TREASURY = "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB";

describe("loadGatewayFinanceConfig", () => {
  it("keeps the legacy direct-settlement mode as the safe default", () => {
    expect(loadGatewayFinanceConfig({})).toEqual({ mode: "ledger" });
  });

  it("requires a checksummed collection address in custodial mode", () => {
    expect(loadGatewayFinanceConfig({
      AGENTPAY_FEE_MODE: "custodial",
      AGENTPAY_GATEWAY_COLLECTION_ADDRESS: COLLECTION,
      AGENTPAY_CUSTODY_LEGAL_APPROVED: "true",
    })).toEqual({ mode: "custodial", collectionAddress: COLLECTION });

    expect(() => loadGatewayFinanceConfig({ AGENTPAY_FEE_MODE: "custodial" }))
      .toThrow("AGENTPAY_CUSTODY_LEGAL_APPROVED");
  });
});

describe("loadPayoutWorkerConfig", () => {
  function environment(overrides: Record<string, string | undefined> = {}) {
    return {
      DATABASE_URL: "postgres://agentpay:secret@postgres:5432/agentpay",
      BASE_MAINNET_RPC_URL: "https://base-rpc.example/",
      AGENTPAY_PAYOUT_PRIVATE_KEY: PAYOUT_KEY,
      AGENTPAY_GATEWAY_COLLECTION_ADDRESS: COLLECTION,
      AGENTPAY_FEE_RECIPIENT: TREASURY,
      AGENTPAY_CUSTODY_LEGAL_APPROVED: "true",
      ...overrides,
    };
  }

  it("derives and verifies the collection address without exposing the key", () => {
    expect(loadPayoutWorkerConfig(environment())).toMatchObject({
      collectionAddress: COLLECTION,
      feeRecipient: TREASURY,
      rpcUrl: "https://base-rpc.example/",
    });
  });

  it("rejects a key that does not control the configured collection wallet", () => {
    expect(() => loadPayoutWorkerConfig(environment({
      AGENTPAY_GATEWAY_COLLECTION_ADDRESS: TREASURY,
    }))).toThrow("AGENTPAY_GATEWAY_COLLECTION_ADDRESS");
  });

  it("rejects reused buyer or facilitator keys and equal treasury/collection wallets", () => {
    expect(() => loadPayoutWorkerConfig(environment({ AGENT_PRIVATE_KEY: PAYOUT_KEY })))
      .toThrow("AGENT_PRIVATE_KEY");
    expect(() => loadPayoutWorkerConfig(environment({ FACILITATOR_PRIVATE_KEY: PAYOUT_KEY })))
      .toThrow("FACILITATOR_PRIVATE_KEY");
    expect(() => loadPayoutWorkerConfig(environment({ AGENTPAY_FEE_RECIPIENT: COLLECTION })))
      .toThrow("AGENTPAY_FEE_RECIPIENT");
  });
});
