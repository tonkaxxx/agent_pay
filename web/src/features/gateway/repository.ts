import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";
import type { PayoutPolicy } from "@/features/finance/policy";

import type { EncryptedSecret } from "./secrets";

export type GatewayDatabase =
  | NodePgDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

export type EndpointStatus = "draft" | "active" | "paused";
export type EndpointAuthMode = "none" | "bearer" | "x-api-key";

export interface EndpointSpec {
  readonly displayName: string;
  readonly upstreamUrl: string;
  readonly authMode: EndpointAuthMode;
  readonly payTo: string;
  readonly amountAtomic: string;
}

export interface EndpointSummary {
  readonly id: string;
  readonly publicId: string;
  readonly ownerId: string;
  readonly displayName: string;
  readonly upstreamUrl: string;
  readonly authMode: EndpointAuthMode;
  readonly payTo: string;
  readonly amountAtomic: string;
  readonly payoutPolicy: PayoutPolicy;
  readonly status: EndpointStatus;
  readonly configVersion: number;
  readonly secretConfigured: boolean;
  readonly lastTestStatus: string | null;
  readonly lastTestHttpStatus: number | null;
  readonly lastTestResponseSize: number | null;
  readonly lastTestLatencyMs: number | null;
  readonly lastTestAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EndpointRecord extends EndpointSummary {
  readonly secretCiphertext: string | null;
  readonly secretIv: string | null;
  readonly secretAuthTag: string | null;
  readonly secretKeyVersion: number | null;
}

const summaryColumns = {
  id: schema.merchantEndpoints.id,
  publicId: schema.merchantEndpoints.publicId,
  ownerId: schema.merchantEndpoints.ownerId,
  displayName: schema.merchantEndpoints.displayName,
  upstreamUrl: schema.merchantEndpoints.upstreamUrl,
  authMode: schema.merchantEndpoints.authMode,
  payTo: schema.merchantEndpoints.payTo,
  amountAtomic: schema.merchantEndpoints.amountAtomic,
  payoutPolicy: schema.merchantEndpoints.payoutPolicy,
  status: schema.merchantEndpoints.status,
  configVersion: schema.merchantEndpoints.configVersion,
  secretConfigured: schema.merchantEndpoints.secretCiphertext,
  lastTestStatus: schema.merchantEndpoints.lastTestStatus,
  lastTestHttpStatus: schema.merchantEndpoints.lastTestHttpStatus,
  lastTestResponseSize: schema.merchantEndpoints.lastTestResponseSize,
  lastTestLatencyMs: schema.merchantEndpoints.lastTestLatencyMs,
  lastTestAt: schema.merchantEndpoints.lastTestAt,
  createdAt: schema.merchantEndpoints.createdAt,
  updatedAt: schema.merchantEndpoints.updatedAt,
} as const;

const recordColumns = {
  ...summaryColumns,
  secretCiphertext: schema.merchantEndpoints.secretCiphertext,
  secretIv: schema.merchantEndpoints.secretIv,
  secretAuthTag: schema.merchantEndpoints.secretAuthTag,
  secretKeyVersion: schema.merchantEndpoints.secretKeyVersion,
} as const;

function readSecretConfigured(row: Record<string, unknown>): boolean {
  if (row.secretConfigured !== undefined) {
    return Boolean(row.secretConfigured);
  }
  return Boolean(row.secretCiphertext);
}

function toSummary(row: Record<string, unknown>): EndpointSummary {
  return {
    id: row.id as string,
    publicId: row.publicId as string,
    ownerId: row.ownerId as string,
    displayName: row.displayName as string,
    upstreamUrl: row.upstreamUrl as string,
    authMode: row.authMode as EndpointAuthMode,
    payTo: row.payTo as string,
    amountAtomic: row.amountAtomic as string,
    payoutPolicy: row.payoutPolicy as PayoutPolicy,
    status: row.status as EndpointStatus,
    configVersion: row.configVersion as number,
    secretConfigured: readSecretConfigured(row),
    lastTestStatus: row.lastTestStatus as string | null,
    lastTestHttpStatus: row.lastTestHttpStatus as number | null,
    lastTestResponseSize: row.lastTestResponseSize as number | null,
    lastTestLatencyMs: row.lastTestLatencyMs as number | null,
    lastTestAt: row.lastTestAt as Date | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function toRecord(row: Record<string, unknown>): EndpointRecord {
  return {
    ...toSummary(row),
    secretCiphertext: row.secretCiphertext as string | null,
    secretIv: row.secretIv as string | null,
    secretAuthTag: row.secretAuthTag as string | null,
    secretKeyVersion: row.secretKeyVersion as number | null,
  };
}

interface AuditInput {
  readonly actorUserId: string;
  readonly eventType: string;
  readonly endpointId?: string;
  readonly metadata?: Record<string, unknown>;
}

async function writeAudit(db: GatewayDatabase, audit: AuditInput): Promise<void> {
  await db.insert(schema.auditEvents).values({
    endpointId: audit.endpointId ?? null,
    actorUserId: audit.actorUserId,
    eventType: audit.eventType,
    metadata: audit.metadata ?? {},
  });
}

export async function listEndpointsForOwner(
  db: GatewayDatabase,
  ownerId: string,
): Promise<EndpointSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(schema.merchantEndpoints)
    .where(eq(schema.merchantEndpoints.ownerId, ownerId))
    .orderBy(desc(schema.merchantEndpoints.createdAt));
  return rows.map((row) => toSummary(row));
}

export async function getEndpointForOwner(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
): Promise<EndpointSummary | null> {
  const rows = await db
    .select(summaryColumns)
    .from(schema.merchantEndpoints)
    .where(
      and(
        eq(schema.merchantEndpoints.id, endpointId),
        eq(schema.merchantEndpoints.ownerId, ownerId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toSummary(row);
}

export async function getEndpointRecord(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
): Promise<EndpointRecord | null> {
  const rows = await db
    .select(recordColumns)
    .from(schema.merchantEndpoints)
    .where(
      and(
        eq(schema.merchantEndpoints.id, endpointId),
        eq(schema.merchantEndpoints.ownerId, ownerId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function findActiveByPublicId(
  db: GatewayDatabase,
  publicId: string,
): Promise<EndpointRecord | null> {
  const rows = await db
    .select(recordColumns)
    .from(schema.merchantEndpoints)
    .where(
      and(
        eq(schema.merchantEndpoints.publicId, publicId),
        eq(schema.merchantEndpoints.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function createEndpoint(
  db: GatewayDatabase,
  ownerId: string,
  spec: EndpointSpec,
  publicId: string,
): Promise<EndpointSummary> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.merchantEndpoints)
      .values({
        publicId,
        ownerId,
        displayName: spec.displayName,
        upstreamUrl: spec.upstreamUrl,
        authMode: spec.authMode,
        payTo: spec.payTo,
        amountAtomic: spec.amountAtomic,
        status: "draft",
      })
      .returning();

    const row = rows[0]!;
    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: "endpoint_created",
      endpointId: row.id,
      metadata: { publicId },
    });
    return toSummary(row);
  });
}

const ALLOWED_TRANSITIONS: Record<EndpointStatus, readonly EndpointStatus[]> = {
  draft: ["active"],
  active: ["paused"],
  paused: ["active"],
};

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot move an endpoint from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export async function transitionEndpointStatus(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  to: EndpointStatus,
): Promise<EndpointSummary | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select(recordColumns)
      .from(schema.merchantEndpoints)
      .where(
        and(
          eq(schema.merchantEndpoints.id, endpointId),
          eq(schema.merchantEndpoints.ownerId, ownerId),
        ),
      )
      .limit(1);
    const current = rows[0];
    if (current === undefined) {
      return null;
    }
    const from = current.status as EndpointStatus;
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new InvalidTransitionError(from, to);
    }
    if (to === "active" && current.authMode === "none") {
      throw new InvalidTransitionError(from, to);
    }
    if (to === "active" && current.authMode !== "none" && current.secretCiphertext === null) {
      throw new InvalidTransitionError(from, to);
    }
    if (to === "active" && current.lastTestStatus !== "ok") {
      throw new InvalidTransitionError(from, to);
    }

    const updated = await tx
      .update(schema.merchantEndpoints)
      .set({
        status: to,
        updatedAt: new Date(),
      })
      .where(eq(schema.merchantEndpoints.id, endpointId))
      .returning();
    const row = updated[0]!;

    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: `endpoint_${to}`,
      endpointId,
      metadata: { from },
    });
    return toSummary(row);
  });
}

export interface EndpointUpdateSpec {
  readonly displayName?: string;
  readonly upstreamUrl?: string;
  readonly authMode?: EndpointAuthMode;
  readonly payTo?: string;
  readonly amountAtomic?: string;
}

const EDITABLE_STATUSES: readonly EndpointStatus[] = ["draft", "paused"];

export async function updateEndpointDetails(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  changes: EndpointUpdateSpec,
): Promise<EndpointSummary | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select(recordColumns)
      .from(schema.merchantEndpoints)
      .where(
        and(
          eq(schema.merchantEndpoints.id, endpointId),
          eq(schema.merchantEndpoints.ownerId, ownerId),
        ),
      )
      .limit(1);
    const current = rows[0];
    if (current === undefined) {
      return null;
    }
    if (!EDITABLE_STATUSES.includes(current.status as EndpointStatus)) {
      throw new InvalidTransitionError(current.status as EndpointStatus, "edit");
    }
    if (changes.authMode !== undefined && changes.authMode === "none") {
      throw new InvalidTransitionError(
        current.status as EndpointStatus,
        "no-auth",
      );
    }

    const updated = await tx
      .update(schema.merchantEndpoints)
      .set({
        ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
        ...(changes.upstreamUrl !== undefined ? { upstreamUrl: changes.upstreamUrl } : {}),
        ...(changes.authMode !== undefined ? { authMode: changes.authMode } : {}),
        ...(changes.payTo !== undefined ? { payTo: changes.payTo } : {}),
        ...(changes.amountAtomic !== undefined ? { amountAtomic: changes.amountAtomic } : {}),
        ...(
          changes.upstreamUrl !== undefined || changes.authMode !== undefined
            ? {
                configVersion: (current.configVersion as number) + 1,
                lastTestStatus: null,
                lastTestHttpStatus: null,
                lastTestResponseSize: null,
                lastTestLatencyMs: null,
                lastTestAt: null,
              }
            : {}
        ),
        updatedAt: new Date(),
      })
      .where(eq(schema.merchantEndpoints.id, endpointId))
      .returning();
    const row = updated[0]!;

    const fields: string[] = [];
    if (changes.displayName !== undefined) fields.push("displayName");
    if (changes.upstreamUrl !== undefined) fields.push("upstreamUrl");
    if (changes.authMode !== undefined) fields.push("authMode");
    if (changes.payTo !== undefined) fields.push("payTo");
    if (changes.amountAtomic !== undefined) fields.push("amountAtomic");

    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: "endpoint_updated",
      endpointId,
      metadata: { fields },
    });
    return toSummary(row);
  });
}

export async function updateEndpointSecret(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  secret: EncryptedSecret,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: schema.merchantEndpoints.id,
        configVersion: schema.merchantEndpoints.configVersion,
      })
      .from(schema.merchantEndpoints)
      .where(
        and(
          eq(schema.merchantEndpoints.id, endpointId),
          eq(schema.merchantEndpoints.ownerId, ownerId),
        ),
      )
      .limit(1);
    const current = rows[0];
    if (current === undefined) {
      return false;
    }
    await tx
      .update(schema.merchantEndpoints)
      .set({
        secretCiphertext: secret.ciphertext,
        secretIv: secret.iv,
        secretAuthTag: secret.authTag,
        secretKeyVersion: secret.keyVersion,
        configVersion: (current.configVersion as number) + 1,
        lastTestStatus: null,
        lastTestHttpStatus: null,
        lastTestResponseSize: null,
        lastTestLatencyMs: null,
        lastTestAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.merchantEndpoints.id, endpointId));
    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: "credential_replaced",
      endpointId,
    });
    return true;
  });
}

export async function updateEndpointPayout(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  payTo: string,
): Promise<EndpointSummary | null> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.merchantEndpoints.id })
      .from(schema.merchantEndpoints)
      .where(
        and(
          eq(schema.merchantEndpoints.id, endpointId),
          eq(schema.merchantEndpoints.ownerId, ownerId),
        ),
      )
      .limit(1);
    const updated = await tx
      .update(schema.merchantEndpoints)
      .set({ payTo, updatedAt: new Date() })
      .where(
        and(
          eq(schema.merchantEndpoints.id, endpointId),
          eq(schema.merchantEndpoints.ownerId, ownerId),
        ),
      )
      .returning();
    const row = updated[0];
    if (row === undefined) {
      return null;
    }
    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: "payout_changed",
      endpointId,
    });
    return toSummary(row);
  });
}

export async function updateEndpointPrice(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  amountAtomic: string,
): Promise<EndpointSummary | null> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.merchantEndpoints)
      .set({ amountAtomic, updatedAt: new Date() })
      .where(
        and(
          eq(schema.merchantEndpoints.id, endpointId),
          eq(schema.merchantEndpoints.ownerId, ownerId),
        ),
      )
      .returning();
    const row = updated[0];
    if (row === undefined) {
      return null;
    }
    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: "price_changed",
      endpointId,
    });
    return toSummary(row);
  });
}

export async function updateEndpointPayoutPolicy(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  payoutPolicy: PayoutPolicy,
): Promise<EndpointSummary | null> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.merchantEndpoints)
      .set({ payoutPolicy, updatedAt: new Date() })
      .where(and(
        eq(schema.merchantEndpoints.id, endpointId),
        eq(schema.merchantEndpoints.ownerId, ownerId),
      ))
      .returning();
    const row = updated[0];
    if (row === undefined) return null;
    await writeAudit(tx, {
      actorUserId: ownerId,
      eventType: "payout_policy_changed",
      endpointId,
      metadata: { payoutPolicy },
    });
    return toSummary(row);
  });
}

export interface ConnectivityResultInput {
  readonly status: string;
  readonly httpStatus: number | null;
  readonly responseSize: number;
  readonly latencyMs: number;
}

export async function recordConnectivityTest(
  db: GatewayDatabase,
  endpointId: string,
  ownerId: string,
  result: ConnectivityResultInput,
): Promise<boolean> {
  const updated = await db
    .update(schema.merchantEndpoints)
    .set({
      lastTestStatus: result.status,
      lastTestHttpStatus: result.httpStatus,
      lastTestResponseSize: result.responseSize,
      lastTestLatencyMs: result.latencyMs,
      lastTestAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.merchantEndpoints.id, endpointId),
        eq(schema.merchantEndpoints.ownerId, ownerId),
      ),
    )
    .returning();
  return updated[0] !== undefined;
}
