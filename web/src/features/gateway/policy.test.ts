import { describe, expect, it } from "vitest";

import { buildGatewayPolicy } from "./policy";

const siteUrl = "https://gateway.example";

const endpoint = {
  publicId: "7f8f3f2e-9b6a-4c4a-9f4f-1a2b3c4d5e6f",
  displayName: "Weather API",
  payTo: "0x0000000000000000000000000000000000001234",
  amountAtomic: "1000000",
} as const;

describe("buildGatewayPolicy", () => {
  it("builds a canonical payment policy for the endpoint", () => {
    const policy = buildGatewayPolicy(endpoint, siteUrl);

    expect(policy.resource).toBe(
      `https://gateway.example/g/${endpoint.publicId}`,
    );
    expect(policy.payTo).toBe(
      "0x0000000000000000000000000000000000001234",
    );
    expect(policy.amountAtomic).toBe("1000000");
    expect(policy.amountUsdc).toBe("1");
    expect(policy.price).toBe("$1");
    expect(policy.description).toBe("Weather API");
    expect(policy.maxTimeoutSeconds).toBe(300);
    expect(policy.scheme).toBe("exact");
    expect(policy.network).toBe("eip155:8453");
  });

  it("rejects a non-canonical site URL when building the resource", () => {
    expect(() =>
      buildGatewayPolicy(endpoint, "not-a-url"),
    ).toThrowError();
  });

  it("keeps the buyer price but routes custodial settlement to the collection wallet", () => {
    const policy = buildGatewayPolicy(endpoint, siteUrl, {
      mode: "custodial",
      collectionAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(policy.payTo).toBe("0x1111111111111111111111111111111111111111");
    expect(policy.amountAtomic).toBe("1000000");
  });
});
