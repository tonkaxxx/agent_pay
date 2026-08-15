import { createClient } from "redis";

interface RedisEvent {
  readonly component: "authorization-store";
  readonly event: "redis_error";
}

type RedisEventLogger = (event: RedisEvent) => void;

const defaultLogger: RedisEventLogger = event => console.info(event);

export function createAuthorizationRedisClient(
  redisUrl: string,
  log: RedisEventLogger = defaultLogger,
) {
  const client = createClient({ url: redisUrl });
  client.on("error", () => log({
    component: "authorization-store",
    event: "redis_error",
  }));
  return client;
}
