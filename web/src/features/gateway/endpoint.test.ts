import { describe, expect, it } from "vitest";

import {
  EndpointValidationError,
  atomicToUsdc,
  newPublicId,
  parseEndpointDraft,
  parsePayToChecksummed,
  parsePriceUsdc,
} from "./endpoint";

const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

describe("parsePriceUsdc", () => {
  it("accepts whole and fractional prices", () => {
    expect(parsePriceUsdc("0.01")).toEqual({ amountAtomic: "10000", amountUsdc: "0.01" });
    expect(parsePriceUsdc("1")).toEqual({ amountAtomic: "1000000", amountUsdc: "1" });
    expect(parsePriceUsdc("0.000001")).toEqual({ amountAtomic: "1", amountUsdc: "0.000001" });
    expect(parsePriceUsdc("1000")).toEqual({ amountAtomic: "1000000000", amountUsdc: "1000" });
  });

  it("rejects zero and out-of-range prices", () => {
    for (const price of ["0", "0.000000", "-1", "1000.000001", "1001"]) {
      expect(() => parsePriceUsdc(price), price).toThrow();
    }
    expect(() => parsePriceUsdc("0.01")).not.toThrow();
  });

  it("rejects malformed prices", () => {
    for (const price of ["", "abc", "1,5", "1e3", "1.2.3", ".5", "5.", "0x10"]) {
      expect(() => parsePriceUsdc(price), price).toThrow();
    }
  });

  it("trims surrounding whitespace before validating", () => {
    expect(parsePriceUsdc(" 0.01 ")).toEqual({ amountAtomic: "10000", amountUsdc: "0.01" });
  });
});

describe("atomicToUsdc", () => {
  it("converts atomic units to a decimal string", () => {
    expect(atomicToUsdc("10000")).toBe("0.01");
    expect(atomicToUsdc("1")).toBe("0.000001");
    expect(atomicToUsdc("0")).toBe("0");
    expect(atomicToUsdc("123456789")).toBe("123.456789");
  });
});

describe("parsePayToChecksummed", () => {
  it("returns the checksummed address", () => {
    expect(parsePayToChecksummed("0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1")).toBe(PAY_TO);
    expect(parsePayToChecksummed(PAY_TO)).toBe(PAY_TO);
  });

  it("rejects invalid or placeholder addresses", () => {
    for (const value of [
      "0x",
      "0x1234",
      "0x0000000000000000000000000000000000000000",
      "0x1111111111111111111111111111111111111111",
      "not-an-address",
      "0x63A4536bC72c6D17A2eC1e6AA14555e0eF9044d1f",
    ]) {
      expect(() => parsePayToChecksummed(value), value).toThrow();
    }
  });
});

describe("newPublicId", () => {
  it("produces unique base64url ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = newPublicId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(100);
  });
});

describe("parseEndpointDraft", () => {
  it("parses a valid authenticated endpoint", () => {
    const parsed = parseEndpointDraft({
      displayName: "  Weather  ",
      upstreamUrl: "https://api.example.com/weather",
      authMode: "bearer",
      price: "0.01",
      payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
      credential: "  secret-token  ",
    });
    expect(parsed.displayName).toBe("Weather");
    expect(parsed.upstreamUrl).toBe("https://api.example.com/weather");
    expect(parsed.authMode).toBe("bearer");
    expect(parsed.credential).toBe("secret-token");
    expect(parsed.amountAtomic).toBe("10000");
    expect(parsed.payTo).toBe(PAY_TO);
  });

  it("allows a draft without an upstream secret", () => {
    const parsed = parseEndpointDraft({
      displayName: "Weather",
      upstreamUrl: "https://api.example.com/weather",
      authMode: "bearer",
      price: "0.01",
      payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
    });
    expect(parsed.credential).toBeUndefined();
  });

  it("allows no-auth mode", () => {
    const parsed = parseEndpointDraft({
      displayName: "Weather",
      upstreamUrl: "https://api.example.com/weather",
      authMode: "none",
      price: "0.01",
      payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
    });
    expect(parsed.authMode).toBe("none");
  });

  it("rejects invalid inputs with the field name", () => {
    const base = {
      displayName: "Weather",
      upstreamUrl: "https://api.example.com/weather",
      authMode: "bearer",
      price: "0.01",
      payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
    };
    const cases: Array<[string, Partial<Record<string, string>>]> = [
      ["displayName", { displayName: "" }],
      ["displayName", { displayName: "x".repeat(81) }],
      ["upstreamUrl", { upstreamUrl: "http://insecure.example.com" }],
      ["upstreamUrl", { upstreamUrl: "https://" }],
      ["authMode", { authMode: "basic" }],
      ["price", { price: "9999" }],
      ["payTo", { payTo: "0xnotvalid" }],
      ["credential", { credential: "x".repeat(2001) }],
      ["credential", { credential: "   " }],
    ];
    for (const [field, overrides] of cases) {
      try {
        parseEndpointDraft({ ...base, ...overrides });
        throw new Error(`expected ${field} to fail`);
      } catch (error) {
        if (error instanceof EndpointValidationError) {
          expect(error.field, field).toBe(field);
        } else {
          expect(field).toBe("no EndpointValidationError thrown");
        }
      }
    }
  });
});
