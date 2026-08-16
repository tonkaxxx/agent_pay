import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";
import { type EncryptedSecret } from "./secrets";
import {
  createEndpoint,
  findActiveByPublicId,
  getEndpointForOwner,
  getEndpointRecord,
  InvalidTransitionError,
  listEndpointsForOwner,
  recordConnectivityTest,
  transitionEndpointStatus,
  updateEndpointDetails,
  updateEndpointPayout,
  updateEndpointPrice,
  updateEndpointSecret,
  type EndpointSpec,
  type EndpointSummary,
} from "./repository";

const OWNER_A = "00000000-0000-0000-0000-00000000000a";
const OWNER_B = "00000000-0000-0000-0000-00000000000b";
const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
  await tdb.db.insert(schema.users).values([
    { id: OWNER_A, name: "Seller A", email: "a@example.test" },
    { id: OWNER_B, name: "Seller B", email: "b@example.test" },
  ]);
});

afterAll(async () => {
  await tdb.close();
});

function spec(overrides: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    displayName: "Weather",
    upstreamUrl: "https://api.example.com/weather",
    authMode: "bearer",
    payTo: PAY_TO,
    amountAtomic: "10000",
    ...overrides,
  };
}

async function createDraft(owner = OWNER_A, publicId = "endpoint-1"): Promise<EndpointSummary> {
  return createEndpoint(tdb.db, owner, spec(), publicId);
}

const secret: EncryptedSecret = {
  keyVersion: 1,
  iv: "iv",
  authTag: "tag",
  ciphertext: "cipher",
};

describe("createEndpoint", () => {
  it("creates a draft without a secret and writes an audit event", async () => {
    const endpoint = await createDraft();
    expect(endpoint).toMatchObject({
      publicId: "endpoint-1",
      ownerId: OWNER_A,
      status: "draft",
      authMode: "bearer",
      amountAtomic: "10000",
      secretConfigured: false,
      configVersion: 1,
    });

    const audits = await tdb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.endpointId, endpoint.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.eventType).toBe("endpoint_created");
  });

  it("creates a no-auth draft", async () => {
    const endpoint = await createEndpoint(tdb.db, OWNER_A, spec({ authMode: "none" }), "endpoint-2");
    expect(endpoint.authMode).toBe("none");
  });
});

describe("listEndpointsForOwner", () => {
  it("only lists the owner's endpoints", async () => {
    await createDraft(OWNER_A, "endpoint-a1");
    await createDraft(OWNER_A, "endpoint-a2");
    await createDraft(OWNER_B, "endpoint-b1");

    const owned = await listEndpointsForOwner(tdb.db, OWNER_A);
    expect(owned.map((e) => e.publicId).sort()).toEqual(["endpoint-a1", "endpoint-a2"]);
  });
});

describe("getEndpointForOwner / getEndpointRecord", () => {
  it("scopes reads to the owner", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    expect(await getEndpointForOwner(tdb.db, endpoint.id, OWNER_A)).not.toBeNull();
    expect(await getEndpointForOwner(tdb.db, endpoint.id, OWNER_B)).toBeNull();
    expect(await getEndpointRecord(tdb.db, endpoint.id, OWNER_A)).not.toBeNull();
    expect(await getEndpointRecord(tdb.db, endpoint.id, OWNER_B)).toBeNull();
  });

  it("does not expose the secret via getEndpointRecord after storage", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    const record = await getEndpointRecord(tdb.db, endpoint.id, OWNER_A);
    expect(record!.secretCiphertext).toBe("cipher");
    expect(record!.secretKeyVersion).toBe(1);
  });
});

describe("findActiveByPublicId", () => {
  it("returns null for unknown, draft, or paused endpoints", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    expect(await findActiveByPublicId(tdb.db, "endpoint-1")).toBeNull();
    expect(await findActiveByPublicId(tdb.db, "unknown")).toBeNull();
    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");
    await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "paused");
    expect(await findActiveByPublicId(tdb.db, "endpoint-1")).toBeNull();
  });

  it("returns the record for an active endpoint", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");
    const found = await findActiveByPublicId(tdb.db, "endpoint-1");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(endpoint.id);
  });
});

describe("transitionEndpointStatus", () => {
  it("rejects activation without a configured secret", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await expect(
      transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active"),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejects activation of a no-auth endpoint", async () => {
    const endpoint = await createEndpoint(tdb.db, OWNER_A, spec({ authMode: "none" }), "endpoint-2");
    await expect(
      transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active"),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("moves a draft to active and back to paused", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);

    const active = await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");
    expect(active!.status).toBe("active");

    const paused = await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "paused");
    expect(paused!.status).toBe("paused");

    const rearmed = await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");
    expect(rearmed!.status).toBe("active");
  });

  it("rejects illegal transitions", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await expect(
      transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "paused"),
    ).rejects.toThrow(InvalidTransitionError);

    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");
    await expect(
      transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "draft"),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("returns null for another owner and writes an audit event on success", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    expect(await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_B, "active")).toBeNull();

    await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");
    const audits = await tdb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "endpoint_active"));
    expect(audits).toHaveLength(1);
  });
});

describe("updateEndpointDetails", () => {
  it("updates draft fields and records the changed fields in audit", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    const updated = await updateEndpointDetails(tdb.db, endpoint.id, OWNER_A, {
      displayName: "Better Weather",
      payTo: PAY_TO,
      upstreamUrl: "https://api.example.com/v2/weather",
      amountAtomic: "25000",
    });
    expect(updated!.displayName).toBe("Better Weather");
    expect(updated!.upstreamUrl).toBe("https://api.example.com/v2/weather");
    expect(updated!.amountAtomic).toBe("25000");

    const audits = await tdb.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "endpoint_updated"));
    expect(audits).toHaveLength(1);
    const metadata = audits[0]!.metadata as { fields?: string[] } | null;
    expect(metadata?.fields).toContain("displayName");
  });

  it("rejects editing an active endpoint and removing auth mode", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "active");

    await expect(
      updateEndpointDetails(tdb.db, endpoint.id, OWNER_A, { displayName: "Nope" }),
    ).rejects.toThrow(InvalidTransitionError);

    const paused = await transitionEndpointStatus(tdb.db, endpoint.id, OWNER_A, "paused");
    await expect(
      updateEndpointDetails(tdb.db, paused!.id, OWNER_A, { authMode: "none" }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

describe("updateEndpointSecret", () => {
  it("stores the encrypted secret and marks it configured", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    expect(endpoint.secretConfigured).toBe(false);
    const ok = await updateEndpointSecret(tdb.db, endpoint.id, OWNER_A, secret);
    expect(ok).toBe(true);

    const summary = await getEndpointForOwner(tdb.db, endpoint.id, OWNER_A);
    expect(summary!.secretConfigured).toBe(true);
  });

  it("refuses to touch another owner's endpoint", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    expect(await updateEndpointSecret(tdb.db, endpoint.id, OWNER_B, secret)).toBe(false);
  });
});

describe("updateEndpointPayout / updateEndpointPrice", () => {
  it("updates payout and price for the owner", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    const payTo = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
    const payout = await updateEndpointPayout(tdb.db, endpoint.id, OWNER_A, payTo);
    expect(payout!.payTo).toBe(payTo);
    const price = await updateEndpointPrice(tdb.db, endpoint.id, OWNER_A, "999999");
    expect(price!.amountAtomic).toBe("999999");
  });

  it("returns null for another owner", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    expect(await updateEndpointPayout(tdb.db, endpoint.id, OWNER_B, PAY_TO)).toBeNull();
    expect(await updateEndpointPrice(tdb.db, endpoint.id, OWNER_B, "1")).toBeNull();
  });
});

describe("recordConnectivityTest", () => {
  it("records test results only for the owner", async () => {
    const endpoint = await createDraft(OWNER_A, "endpoint-1");
    expect(
      await recordConnectivityTest(tdb.db, endpoint.id, OWNER_A, {
        status: "ok",
        httpStatus: 200,
        responseSize: 512,
        latencyMs: 120,
      }),
    ).toBe(true);
    const summary = await getEndpointForOwner(tdb.db, endpoint.id, OWNER_A);
    expect(summary!.lastTestStatus).toBe("ok");
    expect(summary!.lastTestHttpStatus).toBe(200);
    expect(summary!.lastTestLatencyMs).toBe(120);
    expect(summary!.lastTestAt).not.toBeNull();

    expect(
      await recordConnectivityTest(tdb.db, endpoint.id, OWNER_B, {
        status: "ok",
        httpStatus: 200,
        responseSize: 1,
        latencyMs: 1,
      }),
    ).toBe(false);
  });
});
