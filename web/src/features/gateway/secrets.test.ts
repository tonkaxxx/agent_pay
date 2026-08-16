import { describe, expect, it } from "vitest";

import { loadMasterKeyConfig } from "./env";
import {
  createKeyRing,
  decryptSecret,
  encryptSecret,
  SecretDecryptionError,
} from "./secrets";

const key1 = Buffer.alloc(32, 1);
const key2 = Buffer.alloc(32, 2);

describe("encryptSecret / decryptSecret", () => {
  const ring = createKeyRing(7, [
    { version: 6, material: key1 },
    { version: 7, material: key2 },
  ]);

  it("round-trips a plaintext through AES-256-GCM", () => {
    const plaintext = "sk-live_0123456789abcdef";
    const record = encryptSecret(plaintext, 7, ring);
    expect(decryptSecret(record, ring)).toBe(plaintext);
  });

  it("uses a fresh random IV for every encryption", () => {
    const recordA = encryptSecret("token", 7, ring);
    const recordB = encryptSecret("token", 7, ring);
    expect(recordA.iv).not.toBe(recordB.iv);
    expect(recordA.ciphertext).not.toBe(recordB.ciphertext);
  });

  it("fails with a secret-free error on the wrong key", () => {
    const record = encryptSecret("super-secret-value", 7, ring);
    const wrongRing = createKeyRing(1, [{ version: 1, material: Buffer.alloc(32, 9) }]);
    try {
      decryptSecret(record, wrongRing);
      throw new Error("expected decryption to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretDecryptionError);
      expect(String(error)).not.toContain("super-secret-value");
    }
  });

  it("fails on tampered ciphertext or auth tag", () => {
    const record = encryptSecret("super-secret-value", 7, ring);
    const tampered = { ...record, ciphertext: record.ciphertext.slice(0, -2) + "A=" };
    let error: unknown;
    try {
      decryptSecret(tampered, ring);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SecretDecryptionError);
  });

  it("supports key rotation: older ciphertexts stay readable", () => {
    const legacy = encryptSecret("old-token", 6, ring);
    expect(decryptSecret(legacy, ring)).toBe("old-token");
  });

  it("fails when the key version is missing from the ring", () => {
    const record = encryptSecret("token", 7, ring);
    const partialRing = createKeyRing(7, [{ version: 7, material: key2 }]);
    const missing = { ...record, keyVersion: 99 };
    let error: unknown;
    try {
      decryptSecret(missing, partialRing);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SecretDecryptionError);
  });

  it("produces URL-safe base64 fields that fit text columns", () => {
    const record = encryptSecret("token", 7, ring);
    expect(record.iv).not.toMatch(/[+/=]/);
    expect(record.authTag).not.toMatch(/[+/=]/);
    expect(record.ciphertext).not.toMatch(/[+/=]/);
  });
});

describe("keyRingFromBase64", () => {
  it("accepts a valid 32-byte base64 key", () => {
    const base64 = Buffer.alloc(32, 5).toString("base64");
    const ring = createKeyRing(1, [
      { version: 1, material: Buffer.from(base64, "base64") },
    ]);
    expect(ring.currentVersion).toBe(1);
  });
});

describe("loadMasterKeyConfig", () => {
  const goodKey = Buffer.alloc(32, 1).toString("base64");

  it("parses the master key and version", () => {
    const env = loadMasterKeyConfig({
      AGENTPAY_MASTER_KEY: goodKey,
      AGENTPAY_MASTER_KEY_VERSION: "3",
    });
    expect(env.version).toBe(3);
    expect(env.ring.get(3)).toBeDefined();
  });

  it("defaults the version to 1", () => {
    const env = loadMasterKeyConfig({ AGENTPAY_MASTER_KEY: goodKey });
    expect(env.version).toBe(1);
  });

  it("rejects a missing, malformed, or wrong-length key", () => {
    expect(() => loadMasterKeyConfig({})).toThrow(/AGENTPAY_MASTER_KEY/);
    expect(() =>
      loadMasterKeyConfig({ AGENTPAY_MASTER_KEY: "not-base64!" }),
    ).toThrow(/AGENTPAY_MASTER_KEY/);
    expect(() =>
      loadMasterKeyConfig({ AGENTPAY_MASTER_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/AGENTPAY_MASTER_KEY/);
  });

  it("rejects a non-integer version", () => {
    expect(() =>
      loadMasterKeyConfig({
        AGENTPAY_MASTER_KEY: goodKey,
        AGENTPAY_MASTER_KEY_VERSION: "1.5",
      }),
    ).toThrow(/AGENTPAY_MASTER_KEY_VERSION/);
  });
});