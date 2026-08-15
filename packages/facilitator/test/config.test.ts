import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadFacilitatorConfig } from "../src/config.js";

const VALID_KEY = `0x${"12".repeat(32)}`;

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    BASE_MAINNET_RPC_URL: "https://base.example.invalid/rpc",
    FACILITATOR_PRIVATE_KEY: VALID_KEY,
    ...overrides,
  };
}

describe("loadFacilitatorConfig", () => {
  it("loads the Base-only defaults", () => {
    expect(loadFacilitatorConfig(validEnv())).toEqual({
      host: "0.0.0.0",
      port: 4022,
      rpcUrl: "https://base.example.invalid/rpc",
      privateKey: VALID_KEY,
    });
  });

  it.each([
    ["missing RPC", { BASE_MAINNET_RPC_URL: undefined }, "BASE_MAINNET_RPC_URL"],
    ["non-http RPC", { BASE_MAINNET_RPC_URL: "file:///tmp/rpc" }, "BASE_MAINNET_RPC_URL"],
    ["missing key", { FACILITATOR_PRIVATE_KEY: undefined }, "FACILITATOR_PRIVATE_KEY"],
    ["short key", { FACILITATOR_PRIVATE_KEY: "0x1234" }, "FACILITATOR_PRIVATE_KEY"],
    ["zero key", { FACILITATOR_PRIVATE_KEY: `0x${"00".repeat(32)}` }, "FACILITATOR_PRIVATE_KEY"],
    ["bad port", { PORT: "0" }, "PORT"],
    ["fractional port", { PORT: "4022.5" }, "PORT"],
    ["wrong network", { FACILITATOR_NETWORK: `eip155:${84_532}` }, "FACILITATOR_NETWORK"],
    ["buyer key variable", { AGENT_PRIVATE_KEY: "present" }, "AGENT_PRIVATE_KEY"],
  ])("rejects %s", (_name, overrides, variable) => {
    expect(() => loadFacilitatorConfig(validEnv(overrides))).toThrow(variable);
  });

  it("rejects a key whose SHA-256 fingerprint is forbidden", () => {
    const fingerprint = createHash("sha256").update(VALID_KEY.toLowerCase()).digest("hex");

    expect(() => loadFacilitatorConfig(validEnv(), new Set([fingerprint]))).toThrow(
      "FACILITATOR_PRIVATE_KEY",
    );
  });

  it("never includes configuration values in errors", () => {
    const secretRpc = "https://rpc.example.invalid/private-token";

    try {
      loadFacilitatorConfig(validEnv({
        BASE_MAINNET_RPC_URL: secretRpc,
        FACILITATOR_NETWORK: "eip155:1",
      }));
      expect.unreachable("configuration should fail");
    } catch (error) {
      expect(String(error)).not.toContain(secretRpc);
      expect(String(error)).not.toContain(VALID_KEY);
      expect(String(error)).not.toContain("eip155:1");
    }
  });
});
