import { describe, expect, it } from "vitest";

import { assertBaseMainnet } from "../src/signer.js";

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
