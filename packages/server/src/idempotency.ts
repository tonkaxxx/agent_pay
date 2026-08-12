import { createHash, randomUUID } from "node:crypto";

import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import { extractPaymentIdentifier } from "@x402/extensions/payment-identifier";

export interface CachedPaymentResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyBase64: string;
  readonly settlement?: SettleResponse;
}

export interface PaymentIdempotencyBeginInput {
  readonly paymentId: string;
  readonly paymentFingerprint: string;
  readonly pendingTtlSeconds: number;
  readonly completedTtlSeconds: number;
}

export type PaymentIdempotencyBeginResult =
  | { readonly kind: "acquired"; readonly leaseToken: string }
  | { readonly kind: "pending" }
  | { readonly kind: "replay"; readonly response: CachedPaymentResponse }
  | { readonly kind: "conflict" };

export interface PaymentIdempotencyCompleteInput extends PaymentIdempotencyBeginInput {
  readonly leaseToken: string;
  readonly response: CachedPaymentResponse;
}

export interface PaymentIdempotencyReleaseInput extends PaymentIdempotencyBeginInput {
  readonly leaseToken: string;
}

export interface PaymentIdempotencyStore {
  begin(input: PaymentIdempotencyBeginInput): Promise<PaymentIdempotencyBeginResult>;
  complete(input: PaymentIdempotencyCompleteInput): Promise<boolean>;
  release(input: PaymentIdempotencyReleaseInput): Promise<void>;
}

export class PaymentIdempotencyUnavailableError extends Error {
  readonly code = "idempotency_unavailable";

  constructor(options?: ErrorOptions) {
    super("Payment idempotency is unavailable.", options);
    this.name = "PaymentIdempotencyUnavailableError";
  }
}

type PendingEntry = {
  readonly kind: "pending";
  readonly paymentFingerprint: string;
  readonly leaseToken: string;
  readonly expiresAt: number;
};

type CompletedEntry = {
  readonly kind: "completed";
  readonly paymentFingerprint: string;
  readonly response: CachedPaymentResponse;
  readonly expiresAt: number;
};

type InMemoryEntry = PendingEntry | CompletedEntry;

export interface InMemoryPaymentIdempotencyStoreOptions {
  readonly now?: () => number;
  readonly leaseTokenFactory?: () => string;
}

export class InMemoryPaymentIdempotencyStore implements PaymentIdempotencyStore {
  private readonly entries = new Map<string, InMemoryEntry>();
  private readonly now: () => number;
  private readonly leaseTokenFactory: () => string;

  constructor(options: InMemoryPaymentIdempotencyStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.leaseTokenFactory = options.leaseTokenFactory ?? randomUUID;
  }

  async begin(input: PaymentIdempotencyBeginInput): Promise<PaymentIdempotencyBeginResult> {
    const now = this.now();
    const current = this.entries.get(input.paymentId);
    if (current !== undefined && current.expiresAt <= now) {
      this.entries.delete(input.paymentId);
    }

    const active = this.entries.get(input.paymentId);
    if (active !== undefined) {
      if (active.paymentFingerprint !== input.paymentFingerprint) {
        return { kind: "conflict" };
      }
      if (active.kind === "pending") return { kind: "pending" };
      return { kind: "replay", response: active.response };
    }

    const leaseToken = this.leaseTokenFactory();
    this.entries.set(input.paymentId, {
      kind: "pending",
      paymentFingerprint: input.paymentFingerprint,
      leaseToken,
      expiresAt: now + input.pendingTtlSeconds * 1_000,
    });
    return { kind: "acquired", leaseToken };
  }

  async complete(input: PaymentIdempotencyCompleteInput): Promise<boolean> {
    const current = this.entries.get(input.paymentId);
    if (current === undefined
      || current.kind !== "pending"
      || current.expiresAt <= this.now()
      || current.paymentFingerprint !== input.paymentFingerprint
      || current.leaseToken !== input.leaseToken) {
      return false;
    }

    this.entries.set(input.paymentId, {
      kind: "completed",
      paymentFingerprint: input.paymentFingerprint,
      response: input.response,
      expiresAt: this.now() + input.completedTtlSeconds * 1_000,
    });
    return true;
  }

  async release(input: PaymentIdempotencyReleaseInput): Promise<void> {
    const current = this.entries.get(input.paymentId);
    if (current?.kind === "pending"
      && current.paymentFingerprint === input.paymentFingerprint
      && current.leaseToken === input.leaseToken) {
      this.entries.delete(input.paymentId);
    }
  }
}

export interface RedisEvalClient {
  readonly isOpen?: boolean;
  connect?(): Promise<unknown>;
  eval(
    script: string,
    options: { readonly keys: readonly string[]; readonly arguments: readonly string[] },
  ): Promise<unknown>;
}

const beginScript = `
local current = redis.call("GET", KEYS[1])
if not current then
  local pending = cjson.encode({
    kind = "pending",
    paymentFingerprint = ARGV[1],
    leaseToken = ARGV[2]
  })
  redis.call("SET", KEYS[1], pending, "PX", ARGV[3])
  return {"acquired", ARGV[2]}
end
local decoded = cjson.decode(current)
if decoded.paymentFingerprint ~= ARGV[1] then
  return {"conflict"}
end
if decoded.kind == "completed" then
  return {"replay", current}
end
return {"pending"}
`;

const completeScript = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.kind ~= "pending"
  or decoded.paymentFingerprint ~= ARGV[1]
  or decoded.leaseToken ~= ARGV[2] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[3], "PX", ARGV[4])
return 1
`;

const releaseScript = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.kind == "pending"
  and decoded.paymentFingerprint == ARGV[1]
  and decoded.leaseToken == ARGV[2] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function redisResultArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Redis idempotency script returned invalid data.");
  return value.map(item => typeof item === "string" ? item : String(item));
}

function positiveTtl(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

export class RedisPaymentIdempotencyStore implements PaymentIdempotencyStore {
  private connection: Promise<unknown> | undefined;

  constructor(
    private readonly client: RedisEvalClient,
    private readonly prefix = "agentpay:idempotency:v2:",
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

  async begin(input: PaymentIdempotencyBeginInput): Promise<PaymentIdempotencyBeginResult> {
    positiveTtl(input.pendingTtlSeconds, "pendingTtlSeconds");
    positiveTtl(input.completedTtlSeconds, "completedTtlSeconds");
    await this.ready();
    const proposedLease = randomUUID();
    const result = redisResultArray(await this.client.eval(beginScript, {
      keys: [`${this.prefix}${input.paymentId}`],
      arguments: [
        input.paymentFingerprint,
        proposedLease,
        String(input.pendingTtlSeconds * 1_000),
      ],
    }));

    switch (result[0]) {
      case "acquired":
        if (!result[1]) throw new Error("Redis idempotency lease token is missing.");
        return { kind: "acquired", leaseToken: result[1] };
      case "pending":
        return { kind: "pending" };
      case "conflict":
        return { kind: "conflict" };
      case "replay": {
        if (!result[1]) throw new Error("Redis idempotency replay is missing.");
        const parsed = JSON.parse(result[1]) as { response?: CachedPaymentResponse };
        if (!parsed.response) throw new Error("Redis idempotency replay is invalid.");
        return { kind: "replay", response: parsed.response };
      }
      default:
        throw new Error("Redis idempotency script returned an unknown state.");
    }
  }

  async complete(input: PaymentIdempotencyCompleteInput): Promise<boolean> {
    positiveTtl(input.completedTtlSeconds, "completedTtlSeconds");
    await this.ready();
    const completed = JSON.stringify({
      kind: "completed",
      paymentFingerprint: input.paymentFingerprint,
      response: input.response,
    });
    const result = await this.client.eval(completeScript, {
      keys: [`${this.prefix}${input.paymentId}`],
      arguments: [
        input.paymentFingerprint,
        input.leaseToken,
        completed,
        String(input.completedTtlSeconds * 1_000),
      ],
    });
    return Number(result) === 1;
  }

  async release(input: PaymentIdempotencyReleaseInput): Promise<void> {
    await this.ready();
    await this.client.eval(releaseScript, {
      keys: [`${this.prefix}${input.paymentId}`],
      arguments: [input.paymentFingerprint, input.leaseToken],
    });
  }
}

export type PaymentRequestHandler = (request: Request) => Promise<Response>;

export interface WithPaymentIdempotencyOptions {
  readonly store: PaymentIdempotencyStore;
  readonly pendingTtlSeconds?: number;
  readonly completedTtlSeconds?: number;
}

const excludedResponseHeaders = new Set([
  "authorization",
  "connection",
  "keep-alive",
  "payment-signature",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-payment",
]);

function conflictResponse(): Response {
  return Response.json({ error: "payment_identifier_conflict" }, {
    status: 409,
    headers: { "cache-control": "no-store" },
  });
}

function pendingResponse(): Response {
  return Response.json({ error: "payment_in_progress" }, {
    status: 425,
    headers: { "cache-control": "no-store", "retry-after": "1" },
  });
}

function replayResponse(cached: CachedPaymentResponse): Response {
  return new Response(Buffer.from(cached.bodyBase64, "base64"), {
    status: cached.status,
    headers: cached.headers,
  });
}

async function cachedResponse(response: Response, settlement: SettleResponse): Promise<CachedPaymentResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!excludedResponseHeaders.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  });
  const body = Buffer.from(await response.clone().arrayBuffer()).toString("base64");
  return { status: response.status, headers, bodyBase64: body, settlement };
}

async function safeRelease(
  store: PaymentIdempotencyStore,
  input: PaymentIdempotencyReleaseInput,
): Promise<void> {
  try {
    await store.release(input);
  } catch {
    // Releasing is best-effort; the pending lease still expires automatically.
  }
}

export function withPaymentIdempotency(
  handler: PaymentRequestHandler,
  {
    store,
    pendingTtlSeconds = 60,
    completedTtlSeconds = 3_600,
  }: WithPaymentIdempotencyOptions,
): PaymentRequestHandler {
  positiveTtl(pendingTtlSeconds, "pendingTtlSeconds");
  positiveTtl(completedTtlSeconds, "completedTtlSeconds");

  return async request => {
    const paymentSignature = request.headers.get("PAYMENT-SIGNATURE");
    if (!paymentSignature) return handler(request);

    let paymentId: string | null;
    try {
      paymentId = extractPaymentIdentifier(decodePaymentSignatureHeader(paymentSignature));
    } catch {
      return handler(request);
    }
    if (paymentId === null) return handler(request);

    const paymentFingerprint = createHash("sha256").update(paymentSignature).digest("hex");
    const common = {
      paymentId,
      paymentFingerprint,
      pendingTtlSeconds,
      completedTtlSeconds,
    };
    let begin: PaymentIdempotencyBeginResult;
    try {
      begin = await store.begin(common);
    } catch (cause) {
      throw new PaymentIdempotencyUnavailableError({ cause });
    }
    if (begin.kind === "conflict") return conflictResponse();
    if (begin.kind === "pending") return pendingResponse();
    if (begin.kind === "replay") return replayResponse(begin.response);

    const lease = { ...common, leaseToken: begin.leaseToken };
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      await safeRelease(store, lease);
      throw error;
    }

    let settlement: SettleResponse;
    try {
      const header = response.headers.get("PAYMENT-RESPONSE");
      if (!header) throw new Error("PAYMENT-RESPONSE is missing.");
      settlement = decodePaymentResponseHeader(header);
      if (!settlement.success) throw new Error("Payment settlement failed.");
    } catch {
      await safeRelease(store, lease);
      return response;
    }

    const cached = await cachedResponse(response, settlement);
    try {
      const completed = await store.complete({ ...lease, response: cached });
      if (!completed) throw new Error("The payment idempotency lease could not be completed.");
    } catch (cause) {
      if (cause instanceof PaymentIdempotencyUnavailableError) throw cause;
      throw new PaymentIdempotencyUnavailableError({ cause });
    }
    return response;
  };
}
