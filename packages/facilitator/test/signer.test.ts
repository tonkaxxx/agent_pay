import { describe, expect, it } from "vitest";
import { nonceManager } from "viem/accounts";

import {
  assertBaseMainnet,
  createMainnetFacilitatorAccount,
} from "../src/signer.js";

describe("assertBaseMainnet", () => {
  it("accepts Base Mainnet chain id", async () => {
    await expect(assertBaseMainnet({ getChainId: async () => 8453 })).resolves.toBeUndefined();
  });

  it("rejects every other chain without exposing its id", async () => {
    await expect(assertBaseMainnet({ getChainId: async () => 1 })).rejects.toThrow(
      "BASE_MAINNET_RPC_URL",
    );
    await expect(assertBaseMainnet({ getChainId: async () => 1 })).rejects.not.toThrow("1");
  });
});

describe("createMainnetFacilitatorAccount", () => {
  it("creates the facilitator account with viem nonce management", () => {
    const privateKey = `0x${"12".repeat(32)}` as `0x${string}`;
    const account = createMainnetFacilitatorAccount(privateKey);

    expect(account.nonceManager).toBe(nonceManager);
  });
});
