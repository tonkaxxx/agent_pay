import { expect, test, vi } from "vitest";

import { createAuthorizationRedisClient } from "./redis-client";

test("observes Redis errors without logging error or credential contents", () => {
  const log = vi.fn();
  const client = createAuthorizationRedisClient(
    "redis://:redis-secret@redis:6379/0",
    log,
  );

  expect(client.listenerCount("error")).toBeGreaterThan(0);
  client.emit("error", new Error("redis-secret transport failure"));
  expect(log).toHaveBeenCalledWith({
    component: "authorization-store",
    event: "redis_error",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("redis-secret");
  expect(JSON.stringify(log.mock.calls)).not.toContain("transport failure");
});
