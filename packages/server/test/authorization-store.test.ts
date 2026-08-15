import { expect, test, vi } from "vitest";

import {
  AuthorizationStoreUnavailableError,
  RedisAuthorizationStore,
} from "../src/index.js";

const fingerprint = "a".repeat(64);

test("uses atomic v2 state transitions without storing payment material", async () => {
  const evalScript = vi.fn()
    .mockResolvedValueOnce("acquired")
    .mockResolvedValueOnce("pending")
    .mockResolvedValueOnce("consumed")
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(1);
  const store = new RedisAuthorizationStore({ eval: evalScript });

  await expect(store.acquire(fingerprint, "lease-a", 360)).resolves.toBe("acquired");
  await expect(store.acquire(fingerprint, "lease-b", 360)).resolves.toBe("pending");
  await expect(store.acquire(fingerprint, "lease-c", 360)).resolves.toBe("consumed");
  await expect(store.consume(fingerprint, "lease-a", 86_400)).resolves.toBe(true);
  await expect(store.release(fingerprint, "lease-a")).resolves.toBe(true);

  expect(evalScript).toHaveBeenCalledTimes(5);
  for (const call of evalScript.mock.calls) {
    expect(call[1]).toMatchObject({
      keys: [`agentpay:authorization:v2:${fingerprint}`],
    });
    const serialized = JSON.stringify(call[1]);
    expect(serialized).not.toContain("PAYMENT-SIGNATURE");
    expect(serialized).not.toContain("premiumData");
    expect(serialized).not.toMatch(/0x[0-9a-f]{130}/i);
  }
});

test("connects a closed Redis client once before evaluating", async () => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const evalScript = vi.fn().mockResolvedValue("acquired");
  const store = new RedisAuthorizationStore({ isOpen: false, connect, eval: evalScript });

  await store.acquire(fingerprint, "lease", 360);

  expect(connect).toHaveBeenCalledOnce();
  expect(evalScript).toHaveBeenCalledOnce();
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid TTL %s",
  async ttl => {
    const store = new RedisAuthorizationStore({ eval: vi.fn() });
    await expect(store.acquire(fingerprint, "lease", ttl)).rejects.toThrow(
      "pendingTtlSeconds must be a positive integer",
    );
  },
);

test("wraps Redis details in a secret-free unavailable error", async () => {
  const store = new RedisAuthorizationStore({
    eval: vi.fn().mockRejectedValue(new Error("redis://:top-secret@redis:6379")),
  });

  let error: unknown;
  try {
    await store.acquire(fingerprint, "lease", 360);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(AuthorizationStoreUnavailableError);
  expect(String(error)).not.toContain("top-secret");
});
