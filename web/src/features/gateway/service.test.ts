import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";
import {
  createKeyRing,
  decryptSecret,
  type KeyRing,
} from "./secrets";
import {
  changeEndpointPayout,
  changeEndpointPrice,
  createEndpointDraft,
  hasRecentSignIn,
  replaceEndpointCredential,
  recordEndpointConnectivityTest,
  recordSignIn,
  ServiceError,
  setEndpointStatus,
  updateEndpointDraft,
  type ServiceAuth,
} from "./service";

const OWNER = "00000000-0000-0000-0000-00000000000a";
const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

let tdb: TestDatabase;
let auth: ServiceAuth;
let vault: KeyRing;

beforeAll(async () => {
  tdb = await createTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
  await tdb.db.insert(schema.users).values({
    id: OWNER,
    name: "Seller",
    email: "seller@example.test",
  });
  auth = { sellerId: OWNER, db: tdb.db };
  vault = createKeyRing(1, [{ version: 1, material: new Uint8Array(32).fill(7) }]);
});

afterAll(async () => {
  await tdb.close();
});

const draftInput = {
  displayName: "Weather",
  upstreamUrl: "https://api.example.com/weather",
  authMode: "bearer",
  price: "0.01",
  payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
};

describe("createEndpointDraft", () => {
  it("creates a draft and stores an encrypted credential", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "top-secret" }, "public-1", vault);
    expect(summary).toMatchObject({
      publicId: "public-1",
      status: "draft",
      authMode: "bearer",
      secretConfigured: true,
    });

    const record = await tdb.db
      .select()
      .from(schema.merchantEndpoints)
      .where(eq(schema.merchantEndpoints.id, summary.id));
    const row = record[0]!;
    expect(row.secretCiphertext).not.toBe("top-secret");
    expect(decryptSecret(
      {
        keyVersion: row.secretKeyVersion!,
        iv: row.secretIv!,
        authTag: row.secretAuthTag!,
        ciphertext: row.secretCiphertext!,
      },
      vault,
    )).toBe("top-secret");
  });

  it("stores the canonicalized upstream url on creation", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "s" }, "public-2", vault);
    expect(summary.upstreamUrl).toBe("https://api.example.com/weather");
  });

  it("rejects a draft with a hostile upstream url", async () => {
    await expect(
      createEndpointDraft(
        auth,
        { ...draftInput, upstreamUrl: "http://169.254.169.254/latest/meta-data" },
        "public-3",
        vault,
      ),
    ).rejects.toThrow(ServiceError);
  });
});

describe("updateEndpointDraft", () => {
  it("updates an existing draft while keeping the previous secret", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "old-secret" }, "public-1", vault);
    const updated = await updateEndpointDraft(auth, {
      endpointId: summary.id,
      displayName: "Weather v2",
      upstreamUrl: "https://api.example.com/v2/weather",
      authMode: "x-api-key",
      price: "0.02",
      payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
    }, vault);
    expect(updated).toMatchObject({
      displayName: "Weather v2",
      upstreamUrl: "https://api.example.com/v2/weather",
      authMode: "x-api-key",
      amountAtomic: "20000",
      secretConfigured: true,
    });
  });

  it("replaces the secret when a new credential is provided", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "old-secret" }, "public-1", vault);
    const updated = await updateEndpointDraft(auth, {
      endpointId: summary.id,
      displayName: "Weather",
      upstreamUrl: "https://api.example.com/weather",
      authMode: "bearer",
      price: "0.01",
      payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
      credential: "new-secret",
    }, vault);
    expect(updated!.secretConfigured).toBe(true);

    const record = await tdb.db
      .select()
      .from(schema.merchantEndpoints)
      .where(eq(schema.merchantEndpoints.id, summary.id));
    const row = record[0]!;
    expect(decryptSecret(
      {
        keyVersion: row.secretKeyVersion!,
        iv: row.secretIv!,
        authTag: row.secretAuthTag!,
        ciphertext: row.secretCiphertext!,
      },
      vault,
    )).toBe("new-secret");
  });

  it("throws ServiceError for a missing endpoint", async () => {
    await expect(
      updateEndpointDraft(auth, {
        endpointId: "00000000-0000-0000-0000-000000000099",
        displayName: "Weather",
        upstreamUrl: "https://api.example.com/weather",
        authMode: "bearer",
        price: "0.01",
        payTo: "0x63a4536bc72c6d17a2ec1e6aa14555e0ef9044d1",
      }, vault),
    ).rejects.toThrow(ServiceError);
  });
});

describe("setEndpointStatus", () => {
  it("activates only when a secret is configured", async () => {
    const withoutSecret = await createEndpointDraft(auth, { ...draftInput }, "public-1", vault);
    await expect(setEndpointStatus(auth, withoutSecret.id, "active")).rejects.toThrow();

    const withSecret = await createEndpointDraft(auth, { ...draftInput, credential: "s" }, "public-2", vault);
    await recordEndpointConnectivityTest(auth, withSecret.id, {
      status: "ok",
      httpStatus: 200,
      responseSize: 1,
      latencyMs: 1,
    });
    const active = await setEndpointStatus(auth, withSecret.id, "active");
    expect(active.status).toBe("active");

    const paused = await setEndpointStatus(auth, withSecret.id, "paused");
    expect(paused.status).toBe("paused");
  });
});

describe("replaceEndpointCredential", () => {
  it("replaces and re-encrypts the credential", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "first" }, "public-1", vault);
    await replaceEndpointCredential(auth, summary.id, "second", vault);

    const record = await tdb.db
      .select()
      .from(schema.merchantEndpoints)
      .where(eq(schema.merchantEndpoints.id, summary.id));
    const row = record[0]!;
    expect(decryptSecret(
      {
        keyVersion: row.secretKeyVersion!,
        iv: row.secretIv!,
        authTag: row.secretAuthTag!,
        ciphertext: row.secretCiphertext!,
      },
      vault,
    )).toBe("second");
  });
});

describe("changeEndpointPayout / changeEndpointPrice", () => {
  it("allows payout and price changes on a draft without recent auth", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "s" }, "public-1", vault);
    const payout = await changeEndpointPayout(auth, summary.id, PAY_TO, false);
    expect(payout.payTo).toBe(PAY_TO);
    const price = await changeEndpointPrice(auth, summary.id, "0.05", false);
    expect(price.amountAtomic).toBe("50000");
  });

  it("requires recent auth to change payout on an active endpoint", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "s" }, "public-1", vault);
    await recordEndpointConnectivityTest(auth, summary.id, {
      status: "ok",
      httpStatus: 200,
      responseSize: 1,
      latencyMs: 1,
    });
    await setEndpointStatus(auth, summary.id, "active");

    await expect(changeEndpointPayout(auth, summary.id, PAY_TO, false)).rejects.toThrow(ServiceError);
    const payout = await changeEndpointPayout(auth, summary.id, PAY_TO, true);
    expect(payout.payTo).toBe(PAY_TO);

    await expect(changeEndpointPrice(auth, summary.id, "0.05", false)).rejects.toThrow(ServiceError);
  });
});

describe("recordEndpointConnectivityTest", () => {
  it("records a connectivity result", async () => {
    const summary = await createEndpointDraft(auth, { ...draftInput, credential: "s" }, "public-1", vault);
    await recordEndpointConnectivityTest(auth, summary.id, {
      status: "ok",
      httpStatus: 200,
      responseSize: 42,
      latencyMs: 12,
    });
    await expect(recordEndpointConnectivityTest(auth, summary.id, {
      status: "ok",
      httpStatus: 200,
      responseSize: 1,
      latencyMs: 1,
    })).resolves.toBeUndefined();
  });
});

describe("hasRecentSignIn / recordSignIn", () => {
  it("returns false until a sign-in is recorded", async () => {
    expect(await hasRecentSignIn(auth)).toBe(false);
    await recordSignIn(auth);
    expect(await hasRecentSignIn(auth)).toBe(true);
  });

  it("ignores sign-ins from other users", async () => {
    await recordSignIn(auth);
    const other: ServiceAuth = {
      sellerId: "00000000-0000-0000-0000-00000000000b",
      db: tdb.db,
    };
    await tdb.db.insert(schema.users).values({
      id: "00000000-0000-0000-0000-00000000000b",
      email: "b@example.test",
    });
    expect(await hasRecentSignIn(other)).toBe(false);
  });
});
