import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  readonly keyVersion: number;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export interface KeyRing {
  readonly currentVersion: number;
  get(version: number): Uint8Array | undefined;
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function createKeyRing(
  currentVersion: number,
  entries: ReadonlyArray<{ readonly version: number; readonly material: Uint8Array }>,
): KeyRing {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error("Invalid master key version");
  }
  if (entries.length === 0) {
    throw new Error("At least one master key is required");
  }
  const byVersion = new Map<number, Uint8Array>();
  for (const entry of entries) {
    if (entry.material.byteLength !== 32) {
      throw new Error("Master key material must be 32 bytes");
    }
    byVersion.set(entry.version, entry.material);
  }
  if (!byVersion.has(currentVersion)) {
    throw new Error("Missing master key for current version");
  }
  return {
    currentVersion,
    get(version) {
      return byVersion.get(version);
    },
  };
}

export function keyRingFromBase64(
  currentVersion: number,
  base64: string,
): KeyRing {
  const material = Buffer.from(base64, "base64");
  return createKeyRing(currentVersion, [{ version: currentVersion, material }]);
}

export class SecretDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt upstream secret");
    this.name = "SecretDecryptionError";
  }
}

export function encryptSecret(
  plaintext: string,
  keyVersion: number,
  ring: KeyRing,
): EncryptedSecret {
  const key = ring.get(keyVersion);
  if (key === undefined) {
    throw new SecretDecryptionError();
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    keyVersion,
    iv: encodeBase64Url(iv),
    authTag: encodeBase64Url(authTag),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

export function decryptSecret(record: EncryptedSecret, ring: KeyRing): string {
  const key = ring.get(record.keyVersion);
  if (key === undefined) {
    throw new SecretDecryptionError();
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      decodeBase64Url(record.iv),
    );
    decipher.setAuthTag(decodeBase64Url(record.authTag));
    const plaintext = Buffer.concat([
      decipher.update(decodeBase64Url(record.ciphertext)),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
}