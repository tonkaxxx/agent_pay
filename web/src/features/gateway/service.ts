import { and, gte, eq } from "drizzle-orm";

import * as schema from "@/db/schema";

import { parseEndpointDraft, type EndpointDraftInput, type EndpointValidationError } from "./endpoint";
import {
  createEndpoint,
  getEndpointForOwner,
  getEndpointRecord,
  recordConnectivityTest,
  transitionEndpointStatus,
  updateEndpointDetails,
  updateEndpointPayout,
  updateEndpointPrice,
  updateEndpointSecret,
  type ConnectivityResultInput,
  type EndpointStatus,
  type EndpointSummary,
  type GatewayDatabase,
} from "./repository";
import { encryptSecret, type KeyRing } from "./secrets";

export interface ServiceAuth {
  readonly sellerId: string;
  readonly db: GatewayDatabase;
}

export type CreateDraftInput = EndpointDraftInput;

export class ServiceError extends Error {
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = "ServiceError";
    this.field = field;
  }
}

function validationError(error: EndpointValidationError): ServiceError {
  return new ServiceError(error.message, error.field);
}

export async function createEndpointDraft(
  auth: ServiceAuth,
  input: CreateDraftInput,
  publicId: string,
  vault: KeyRing,
): Promise<EndpointSummary> {
  let parsed;
  try {
    parsed = parseEndpointDraft(input);
  } catch (error) {
    throw validationError(error as EndpointValidationError);
  }
  const summary = await createEndpoint(auth.db, auth.sellerId, {
    displayName: parsed.displayName,
    upstreamUrl: parsed.upstreamUrl,
    authMode: parsed.authMode,
    payTo: parsed.payTo,
    amountAtomic: parsed.amountAtomic,
  }, publicId);
  if (parsed.credential !== undefined && parsed.authMode !== "none") {
    const secret = encryptSecret(parsed.credential, vault.currentVersion, vault);
    await updateEndpointSecret(auth.db, summary.id, auth.sellerId, secret);
    const fresh = await getEndpointForOwner(auth.db, summary.id, auth.sellerId);
    return fresh ?? summary;
  }
  return summary;
}

export interface UpdateDraftInput {
  readonly endpointId: string;
  readonly displayName: string;
  readonly upstreamUrl: string;
  readonly authMode: string;
  readonly price: string;
  readonly payTo: string;
  readonly credential?: string;
}

export async function updateEndpointDraft(
  auth: ServiceAuth,
  input: UpdateDraftInput,
  vault: KeyRing,
): Promise<EndpointSummary> {
  const current = await getEndpointRecord(auth.db, input.endpointId, auth.sellerId);
  if (current === null) {
    throw new ServiceError("Endpoint not found");
  }

  let parsed;
  try {
    parsed = parseEndpointDraft({
      displayName: input.displayName,
      upstreamUrl: input.upstreamUrl,
      authMode: input.authMode,
      price: input.price,
      payTo: input.payTo,
      ...(input.credential !== undefined ? { credential: input.credential } : {}),
    });
  } catch (error) {
    throw validationError(error as EndpointValidationError);
  }

  const summary = await updateEndpointDetails(auth.db, input.endpointId, auth.sellerId, {
    displayName: parsed.displayName,
    upstreamUrl: parsed.upstreamUrl,
    authMode: parsed.authMode,
    payTo: parsed.payTo,
    amountAtomic: parsed.amountAtomic,
  });
  if (summary === null) {
    throw new ServiceError("Endpoint not found");
  }
  if (parsed.credential !== undefined && parsed.authMode !== "none") {
    const secret = encryptSecret(parsed.credential, vault.currentVersion, vault);
    await updateEndpointSecret(auth.db, input.endpointId, auth.sellerId, secret);
  }
  return summary;
}

export async function setEndpointStatus(
  auth: ServiceAuth,
  endpointId: string,
  status: EndpointStatus,
): Promise<EndpointSummary> {
  const updated = await transitionEndpointStatus(auth.db, endpointId, auth.sellerId, status);
  if (updated === null) {
    throw new ServiceError("Endpoint not found");
  }
  return updated;
}

export async function replaceEndpointCredential(
  auth: ServiceAuth,
  endpointId: string,
  credential: string,
  vault: KeyRing,
): Promise<void> {
  const current = await getEndpointRecord(auth.db, endpointId, auth.sellerId);
  if (current === null) {
    throw new ServiceError("Endpoint not found");
  }
  const secret = encryptSecret(credential, vault.currentVersion, vault);
  const ok = await updateEndpointSecret(auth.db, endpointId, auth.sellerId, secret);
  if (!ok) {
    throw new ServiceError("Endpoint not found");
  }
}

export async function changeEndpointPayout(
  auth: ServiceAuth,
  endpointId: string,
  payTo: string,
  recentAuth: boolean,
): Promise<EndpointSummary> {
  const current = await getEndpointRecord(auth.db, endpointId, auth.sellerId);
  if (current === null) {
    throw new ServiceError("Endpoint not found");
  }
  if (current.status === "active" && !recentAuth) {
    throw new ServiceError("Recent authentication required for payout changes on an active endpoint", "confirmation");
  }
  const updated = await updateEndpointPayout(auth.db, endpointId, auth.sellerId, payTo);
  if (updated === null) {
    throw new ServiceError("Endpoint not found");
  }
  return updated;
}

export async function changeEndpointPrice(
  auth: ServiceAuth,
  endpointId: string,
  price: string,
  recentAuth: boolean,
): Promise<EndpointSummary> {
  const current = await getEndpointRecord(auth.db, endpointId, auth.sellerId);
  if (current === null) {
    throw new ServiceError("Endpoint not found");
  }
  if (current.status === "active" && !recentAuth) {
    throw new ServiceError("Recent authentication required for price changes on an active endpoint", "confirmation");
  }
  let parsedPrice;
  try {
    parsedPrice = parseEndpointDraft({
      displayName: current.displayName,
      upstreamUrl: current.upstreamUrl,
      authMode: current.authMode,
      price,
      payTo: current.payTo,
    });
  } catch (error) {
    throw validationError(error as EndpointValidationError);
  }
  const updated = await updateEndpointPrice(auth.db, endpointId, auth.sellerId, parsedPrice.amountAtomic);
  if (updated === null) {
    throw new ServiceError("Endpoint not found");
  }
  return updated;
}

export async function recordEndpointConnectivityTest(
  auth: ServiceAuth,
  endpointId: string,
  result: ConnectivityResultInput,
): Promise<void> {
  const ok = await recordConnectivityTest(auth.db, endpointId, auth.sellerId, result);
  if (!ok) {
    throw new ServiceError("Endpoint not found");
  }
}

const RECENT_AUTH_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function hasRecentSignIn(
  auth: ServiceAuth,
): Promise<boolean> {
  const since = new Date(Date.now() - RECENT_AUTH_WINDOW_MS);
  const rows = await auth.db
    .select({ id: schema.auditEvents.id })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.actorUserId, auth.sellerId),
        eq(schema.auditEvents.eventType, "sign_in"),
        gte(schema.auditEvents.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function recordSignIn(auth: ServiceAuth): Promise<void> {
  await auth.db.insert(schema.auditEvents).values({
    actorUserId: auth.sellerId,
    eventType: "sign_in",
    metadata: {},
  });
}