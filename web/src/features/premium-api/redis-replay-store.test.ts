import { expect, test, vi } from "vitest";

import { RedisReplayStore } from "./redis-replay-store";

test("atomically claims a permanent namespaced replay key with SET NX", async () => {
  const client = { set: vi.fn().mockResolvedValue("OK") };
  const store = new RedisReplayStore(client);

  await expect(store.claim("8453:0xabc")).resolves.toBe(true);
  expect(client.set).toHaveBeenCalledWith(
    "agentpay:replay:8453:0xabc",
    "1",
    { NX: true },
  );
});

test("rejects an already claimed transaction", async () => {
  const store = new RedisReplayStore({ set: vi.fn().mockResolvedValue(null) });

  await expect(store.claim("8453:0xabc")).resolves.toBe(false);
});

test("connects lazily before the first replay claim", async () => {
  const client = {
    isOpen: false,
    connect: vi.fn(async function (this: { isOpen: boolean }) {
      this.isOpen = true;
    }),
    set: vi.fn().mockResolvedValue("OK"),
  };
  const store = new RedisReplayStore(client);

  await store.claim("8453:0xabc");

  expect(client.connect).toHaveBeenCalledOnce();
  expect(client.set).toHaveBeenCalledOnce();
});

test("retries a Redis connection after a transient connection failure", async () => {
  let isOpen = false;
  const connect = vi.fn()
    .mockRejectedValueOnce(new Error("temporary Redis outage"))
    .mockImplementationOnce(async () => {
      isOpen = true;
    });
  const client = {
    get isOpen() { return isOpen; },
    connect,
    set: vi.fn().mockResolvedValue("OK"),
  };
  const store = new RedisReplayStore(client);

  await expect(store.claim("8453:0xabc")).rejects.toThrow("temporary Redis outage");
  await expect(store.claim("8453:0xabc")).resolves.toBe(true);

  expect(connect).toHaveBeenCalledTimes(2);
  expect(client.set).toHaveBeenCalledOnce();
});
