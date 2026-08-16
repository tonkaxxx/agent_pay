import { describe, expect, it } from "vitest";

import { ForbiddenAddressError, resolvePinned } from "./resolve";

describe("resolvePinned", () => {
  it("returns public addresses", async () => {
    const pinned = await resolvePinned("example.com", async () => [
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(pinned.map((p) => p.address)).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(pinned[0]?.family).toBe(4);
    expect(pinned[1]?.family).toBe(6);
  });

  it("rejects when any candidate is forbidden", async () => {
    await expect(
      resolvePinned("evil.example", async () => ["8.8.8.8", "127.0.0.1"]),
    ).rejects.toThrow(ForbiddenAddressError);
  });

  it("rejects link-local and private candidates", async () => {
    await expect(
      resolvePinned("metadata.example", async () => ["169.254.169.254"]),
    ).rejects.toThrow(ForbiddenAddressError);
    await expect(
      resolvePinned("private.example", async () => ["10.1.2.3"]),
    ).rejects.toThrow(ForbiddenAddressError);
    await expect(
      resolvePinned("loopback.example", async () => ["::1"]),
    ).rejects.toThrow(ForbiddenAddressError);
  });

  it("rejects when no addresses resolve", async () => {
    await expect(resolvePinned("empty.example", async () => [])).rejects.toThrow(
      ForbiddenAddressError,
    );
  });
});