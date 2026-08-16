import { describe, expect, it } from "vitest";

import {
  expandIpv6,
  isForbiddenAddress,
  isForbiddenIpv4,
  isForbiddenIpv6,
  isIpv4MappedIpv6,
  ipv4ToBigInt,
} from "./ip";

describe("ipv4ToBigInt", () => {
  it("parses dotted decimal addresses", () => {
    expect(ipv4ToBigInt("8.8.8.8")).toBe(0x08080808n);
    expect(ipv4ToBigInt("0.0.0.0")).toBe(0n);
  });

  it("rejects malformed addresses", () => {
    expect(ipv4ToBigInt("8.8.8")).toBeNull();
    expect(ipv4ToBigInt("256.1.1.1")).toBeNull();
    expect(ipv4ToBigInt("1.2.3.4.5")).toBeNull();
    expect(ipv4ToBigInt("1.2.3.abc")).toBeNull();
    expect(ipv4ToBigInt("")).toBeNull();
  });
});

describe("isForbiddenIpv4", () => {
  const forbidden = [
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ];
  for (const ip of forbidden) {
    it(`rejects ${ip}`, () => {
      expect(isForbiddenIpv4(ip)).toBe(true);
    });
  }

  const allowed = [
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "100.128.0.1",
    "172.32.0.1",
    "192.0.3.1",
    "203.0.114.1",
    "198.20.0.1",
  ];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => {
      expect(isForbiddenIpv4(ip)).toBe(false);
    });
  }
});

describe("expandIpv6", () => {
  it("parses compressed addresses", () => {
    expect(Array.from(expandIpv6("::")!)).toEqual(new Array(8).fill(0));
    expect(Array.from(expandIpv6("::1")!)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(expandIpv6("fe80::1")!)[0]).toBe(0xfe80);
    expect(Array.from(expandIpv6("fe80::1")!)[7]).toBe(1);
    expect(Array.from(expandIpv6("2001:db8::1")!).slice(0, 2)).toEqual([0x2001, 0x0db8]);
  });

  it("parses full addresses without compression", () => {
    const groups = expandIpv6("1:2:3:4:5:6:7:8");
    expect(Array.from(groups!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("parses ipv4-mapped and embedded addresses", () => {
    const mapped = expandIpv6("::ffff:8.8.8.8");
    expect(Array.from(mapped!.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0xffff]);
    expect(mapped![6]).toBe(0x0808);
    expect(mapped![7]).toBe(0x0808);
  });

  it("rejects zone identifiers and malformed input", () => {
    expect(expandIpv6("fe80::1%eth0")).toBeNull();
    expect(expandIpv6("not-an-ip")).toBeNull();
    expect(expandIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});

describe("isIpv4MappedIpv6", () => {
  it("detects mapped addresses and returns the ipv4 value", () => {
    expect(isIpv4MappedIpv6("::ffff:169.254.1.1")).toBe(0xa9fe0101n);
    expect(isIpv4MappedIpv6("::ffff:8.8.8.8")).toBe(0x08080808n);
  });

  it("returns null for non-mapped addresses", () => {
    expect(isIpv4MappedIpv6("::1")).toBeNull();
    expect(isIpv4MappedIpv6("2001:db8::1")).toBeNull();
  });
});

describe("isForbiddenIpv6", () => {
  const forbidden = [
    "::",
    "::1",
    "fc00::1",
    "fd12:3456:789a::2",
    "fe80::1",
    "fe80::169.254.169.254",
    "ff02::1",
    "ff05::1:3",
    "2001:db8::1",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "::ffff:169.254.169.254",
    "::ffff:192.168.1.1",
    "::ffff:10.0.0.5",
  ];
  for (const ip of forbidden) {
    it(`rejects ${ip}`, () => {
      expect(isForbiddenIpv6(ip)).toBe(true);
    });
  }

  const allowed = [
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2620:fe::fe",
    "2a00:1450:4001:81e::200e",
    "::ffff:8.8.8.8",
    "::ffff:1.1.1.1",
    "2400:cb00:2048:1::c629:d7a2",
  ];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => {
      expect(isForbiddenIpv6(ip)).toBe(false);
    });
  }
});

describe("isForbiddenAddress", () => {
  it("rejects loopback and metadata ranges", () => {
    expect(isForbiddenAddress("127.0.0.1")).toBe(true);
    expect(isForbiddenAddress("169.254.169.254")).toBe(true);
    expect(isForbiddenAddress("::1")).toBe(true);
    expect(isForbiddenAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isForbiddenAddress("8.8.8.8")).toBe(false);
    expect(isForbiddenAddress("2001:4860:4860::8888")).toBe(false);
  });
});