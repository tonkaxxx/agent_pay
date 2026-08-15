import type { FacilitatorEvmSigner } from "@x402/evm";
import { describe, expect, it } from "vitest";

import { createMainnetFacilitator } from "../src/service.js";

const signer: FacilitatorEvmSigner = {
  getAddresses: () => ["0x1111111111111111111111111111111111111111"],
  readContract: async () => undefined,
  verifyTypedData: async () => true,
  writeContract: async () => `0x${"12".repeat(32)}`,
  sendTransaction: async () => `0x${"34".repeat(32)}`,
  waitForTransactionReceipt: async () => ({ status: "success" }),
  getCode: async () => undefined,
};

describe("createMainnetFacilitator", () => {
  it("advertises only exact x402 v2 on Base Mainnet", () => {
    const supported = createMainnetFacilitator(signer).getSupported();

    expect(supported.kinds).toEqual([
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:8453",
      },
    ]);
    expect(supported.extensions).toEqual([]);
  });
});
