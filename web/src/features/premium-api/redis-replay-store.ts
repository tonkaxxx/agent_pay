import type { ReplayStore } from "@x402/server";

export interface RedisSetClient {
  readonly isOpen?: boolean;
  connect?(): Promise<unknown>;
  set(key: string, value: string, options: { NX: true }): Promise<string | null>;
}

export class RedisReplayStore implements ReplayStore {
  private connection: Promise<unknown> | undefined;

  constructor(
    private readonly client: RedisSetClient,
    private readonly prefix = "agentpay:replay:",
  ) {}

  async claim(key: string): Promise<boolean> {
    if (this.client.isOpen === false && this.client.connect !== undefined) {
      const connection = this.connection ??= this.client.connect();
      try {
        await connection;
      } finally {
        if (this.connection === connection) this.connection = undefined;
      }
    }
    return await this.client.set(`${this.prefix}${key}`, "1", { NX: true }) === "OK";
  }
}
