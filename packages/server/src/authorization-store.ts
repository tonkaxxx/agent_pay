export type AuthorizationAcquireResult = "acquired" | "pending" | "consumed";

export interface AuthorizationStore {
  acquire(
    fingerprint: string,
    leaseToken: string,
    pendingTtlSeconds: number,
  ): Promise<AuthorizationAcquireResult>;
  consume(
    fingerprint: string,
    leaseToken: string,
    consumedTtlSeconds: number,
  ): Promise<boolean>;
  release(fingerprint: string, leaseToken: string): Promise<boolean>;
}

export interface RedisEvalClient {
  readonly isOpen?: boolean;
  connect?(): Promise<unknown>;
  eval(
    script: string,
    options: { readonly keys: readonly string[]; readonly arguments: readonly string[] },
  ): Promise<unknown>;
}

export class AuthorizationStoreUnavailableError extends Error {
  readonly code = "payment_infrastructure_unavailable";

  constructor(options?: ErrorOptions) {
    super("Payment authorization state is unavailable.", options);
    this.name = "AuthorizationStoreUnavailableError";
  }
}

const acquireScript = `
local current = redis.call("GET", KEYS[1])
if not current then
  redis.call("SET", KEYS[1], "pending:" .. ARGV[1], "EX", ARGV[2])
  return "acquired"
end
if current == "consumed" then return "consumed" end
return "pending"
`;

const consumeScript = `
local current = redis.call("GET", KEYS[1])
if current ~= "pending:" .. ARGV[1] then return 0 end
redis.call("SET", KEYS[1], "consumed", "EX", ARGV[2])
return 1
`;

const releaseScript = `
local current = redis.call("GET", KEYS[1])
if current ~= "pending:" .. ARGV[1] then return 0 end
return redis.call("DEL", KEYS[1])
`;

function positiveTtl(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

function validFingerprint(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError("fingerprint must be a lowercase SHA-256 digest.");
  }
}

function validLease(value: string): void {
  if (value.trim() === "") throw new TypeError("leaseToken must not be empty.");
}

function stringResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

export class RedisAuthorizationStore implements AuthorizationStore {
  private connection: Promise<unknown> | undefined;

  constructor(
    private readonly client: RedisEvalClient,
    private readonly prefix = "agentpay:authorization:v2:",
  ) {}

  private async ready(): Promise<void> {
    if (this.client.isOpen !== false || this.client.connect === undefined) return;
    const connection = this.connection ??= this.client.connect();
    try {
      await connection;
    } finally {
      if (this.connection === connection) this.connection = undefined;
    }
  }

  private key(fingerprint: string): string {
    validFingerprint(fingerprint);
    return `${this.prefix}${fingerprint}`;
  }

  async acquire(
    fingerprint: string,
    leaseToken: string,
    pendingTtlSeconds: number,
  ): Promise<AuthorizationAcquireResult> {
    positiveTtl(pendingTtlSeconds, "pendingTtlSeconds");
    validLease(leaseToken);
    const key = this.key(fingerprint);
    try {
      await this.ready();
      const result = stringResult(await this.client.eval(acquireScript, {
        keys: [key],
        arguments: [leaseToken, String(pendingTtlSeconds)],
      }));
      if (result === "acquired" || result === "pending" || result === "consumed") return result;
      throw new Error("Redis authorization script returned an unknown state.");
    } catch (cause) {
      if (cause instanceof AuthorizationStoreUnavailableError) throw cause;
      throw new AuthorizationStoreUnavailableError({ cause });
    }
  }

  async consume(
    fingerprint: string,
    leaseToken: string,
    consumedTtlSeconds: number,
  ): Promise<boolean> {
    positiveTtl(consumedTtlSeconds, "consumedTtlSeconds");
    validLease(leaseToken);
    const key = this.key(fingerprint);
    try {
      await this.ready();
      const result = await this.client.eval(consumeScript, {
        keys: [key],
        arguments: [leaseToken, String(consumedTtlSeconds)],
      });
      return Number(result) === 1;
    } catch (cause) {
      throw new AuthorizationStoreUnavailableError({ cause });
    }
  }

  async release(fingerprint: string, leaseToken: string): Promise<boolean> {
    validLease(leaseToken);
    const key = this.key(fingerprint);
    try {
      await this.ready();
      const result = await this.client.eval(releaseScript, {
        keys: [key],
        arguments: [leaseToken],
      });
      return Number(result) === 1;
    } catch (cause) {
      throw new AuthorizationStoreUnavailableError({ cause });
    }
  }
}
