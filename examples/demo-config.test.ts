import { describe, expect, test } from "vitest";

import {
  DEMO_NETWORKS,
  DEMO_PRICE_USDC,
  assertMainnetAllowed,
  executeRequested,
  loadDemoEnvironment,
  modeFromArguments,
  validatedPrivateKey,
  vendorApiUrlFromEnvironment,
} from "./demo-config.js";

const commonEnvironment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
  AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  VENDOR_API_URL: "http://127.0.0.1:3000/api/data",
  PORT: "3000",
};

describe("demo configuration", () => {
  test("selects Sepolia unless the command explicitly contains --mainnet", () => {
    expect(modeFromArguments([])).toBe("sepolia");
    expect(modeFromArguments(["--mainnet"])).toBe("mainnet");
    expect(modeFromArguments(["--chain-id=8453"])).toBe("sepolia");
  });

  test("selects only the RPC variable belonging to the explicit mode", () => {
    expect(loadDemoEnvironment("sepolia", commonEnvironment).rpcUrl)
      .toBe("https://sepolia.base.org/");
    expect(loadDemoEnvironment("mainnet", commonEnvironment).rpcUrl)
      .toBe("https://mainnet.base.org/");
  });

  test("defines fixed official networks and price", () => {
    expect(DEMO_PRICE_USDC).toBe("0.01");
    expect(DEMO_NETWORKS.sepolia).toMatchObject({
      chainId: 84532,
      network: "base-sepolia",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });
    expect(DEMO_NETWORKS.mainnet).toMatchObject({
      chainId: 8453,
      network: "base",
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
  });

  test.each([
    "http://localhost:3000/api/data",
    "http://127.0.0.1:3001/api/data",
    "http://127.0.0.1:3000/other",
    "http://user@127.0.0.1:3000/api/data",
    "http://127.0.0.1:3000/api/data?q=1",
    "http://127.0.0.1:3000/api/data#fragment",
  ])("rejects unsafe mainnet Vendor URL %s", (vendorApiUrl) => {
    const config = loadDemoEnvironment("mainnet", commonEnvironment);
    expect(() => vendorApiUrlFromEnvironment(config, {
      ...commonEnvironment,
      VENDOR_API_URL: vendorApiUrl,
    })).toThrow(/VENDOR_API_URL/);
  });

  test("requires the exact mainnet opt-in", () => {
    expect(() => assertMainnetAllowed({ ...commonEnvironment })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
    expect(() => assertMainnetAllowed({
      ...commonEnvironment,
      ALLOW_MAINNET_PAYMENTS: "TRUE",
    })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
    expect(() => assertMainnetAllowed({
      ...commonEnvironment,
      ALLOW_MAINNET_PAYMENTS: "true",
    })).not.toThrow();
  });

  test("recognizes only the exact execute flag", () => {
    expect(executeRequested(["--execute"])).toBe(true);
    expect(executeRequested(["execute", "--dry-run"])).toBe(false);
  });
});

test.each(["", "ftp://rpc.example"])("rejects invalid mainnet RPC %j", (rpcUrl) => {
  expect(() => loadDemoEnvironment("mainnet", {
    ...commonEnvironment,
    BASE_MAINNET_RPC_URL: rpcUrl,
  })).toThrow(/BASE_MAINNET_RPC_URL/);
});

test("rejects a malformed Vendor address", () => {
  expect(() => loadDemoEnvironment("sepolia", {
    ...commonEnvironment,
    VENDOR_WALLET_ADDRESS: "not-an-address",
  })).toThrow(/VENDOR_WALLET_ADDRESS/);
});

test.each([undefined, "not-a-key", `0x${"11".repeat(31)}`])(
  "rejects malformed agent private key %j",
  (privateKey) => {
    expect(() => validatedPrivateKey(privateKey)).toThrow(/AGENT_PRIVATE_KEY/);
  },
);

test.each(["0", "65536", "1.5"])("rejects invalid PORT %s", (port) => {
  expect(() => loadDemoEnvironment("sepolia", {
    ...commonEnvironment,
    PORT: port,
  })).toThrow(/PORT/);
});
