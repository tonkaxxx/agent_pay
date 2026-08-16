import { describe, expect, it } from "vitest";

import { UpstreamUrlPolicyError, validateUpstreamUrl } from "./url-policy";

describe("validateUpstreamUrl", () => {
  it("accepts canonical public https urls", () => {
    for (const raw of [
      "https://api.example.com/v1/weather",
      "https://data.example.com/deep/path",
      "https://8.8.8.8/status",
    ]) {
      const url = validateUpstreamUrl(raw);
      expect(url.protocol).toBe("https:");
    }
  });

  it("rejects structurally invalid urls", () => {
    for (const raw of [
      "http://api.example.com/x",
      "ftp://api.example.com/x",
      "https://api.example.com:8443/x",
      "https://user:pass@api.example.com/x",
      "https://api.example.com/x?y=1",
    ]) {
      expect(() => validateUpstreamUrl(raw)).toThrow(UpstreamUrlPolicyError);
    }
  });

  it("rejects forbidden hostnames and literals", () => {
    for (const raw of [
      "https://localhost/x",
      "https://LOCALHOST./x",
      "https://api.localhost/x",
      "https://intranet.local/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.5.1/x",
      "https://[::1]/x",
      "https://[fe80::1]/x",
      "https://[::ffff:169.254.169.254]/x",
      "https://postgres/x",
    ]) {
      expect(() => validateUpstreamUrl(raw)).toThrow(UpstreamUrlPolicyError);
    }
  });
});