import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";
import { testConnectivityAction } from "./actions";
import { newPublicId } from "./endpoint";
import { createKeyRing } from "./secrets";
import { createEndpointDraft, type ServiceAuth } from "./service";
import { runConnectivityTest } from "./upstream/connectivity";

vi.mock("@/auth", () => ({
  auth: vi.fn(() =>
    Promise.resolve({ user: { id: OWNER, email: "seller@example.test" } }),
  ),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
let currentDb: TestDatabase | undefined;
vi.mock("@/db", () => ({
  getDatabase: () => {
    if (currentDb === undefined) {
      throw new Error("db not ready");
    }
    return { db: currentDb.db, close: () => Promise.resolve(), pool: null };
  },
}));
vi.mock("./upstream/connectivity", () => ({
  runConnectivityTest: vi.fn(),
}));

const mockRunConnectivityTest = vi.mocked(runConnectivityTest);

const OWNER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

let tdb: TestDatabase;
let auth: ServiceAuth;
const vault = createKeyRing(1, [{ version: 1, material: new Uint8Array(32).fill(7) }]);

beforeAll(async () => {
  process.env.AGENTPAY_MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
  process.env.AGENTPAY_MASTER_KEY_VERSION = "1";
  tdb = await createTestDatabase();
  currentDb = tdb;
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
  await tdb.db.insert(schema.users).values([
    { id: OWNER, name: "Seller", email: "seller@example.test" },
    { id: OTHER, name: "Other", email: "other@example.test" },
  ]);
  auth = { sellerId: OWNER, db: tdb.db };
  vi.clearAllMocks();
});

afterAll(async () => {
  await tdb.close();
});

const draft = {
  displayName: "Weather",
  upstreamUrl: "https://api.example.com/weather",
  authMode: "bearer",
  price: "0.01",
  payTo: PAY_TO,
};

async function seededEndpoint(): Promise<string> {
  const summary = await createEndpointDraft(
    auth,
    { ...draft, credential: "top-secret" },
    newPublicId(),
    vault,
  );
  return summary.id;
}

function form(endpointId: string): FormData {
  const f = new FormData();
  f.set("endpointId", endpointId);
  return f;
}

describe("testConnectivityAction", () => {
  it("records a successful connectivity result", async () => {
    const endpointId = await seededEndpoint();
    mockRunConnectivityTest.mockResolvedValue({
      ok: true,
      status: "ok",
      httpStatus: 200,
      responseSize: 512,
      latencyMs: 42,
    });

    const state = await testConnectivityAction({}, form(endpointId));

    expect(state).toEqual({
      success: "Upstream answered HTTP 200 in 42 ms.",
    });
    expect(mockRunConnectivityTest).toHaveBeenCalledWith({
      url: expect.any(URL),
      credential: { mode: "bearer", value: "top-secret" },
    });
    const record = await tdb.db
      .select({
        status: schema.merchantEndpoints.lastTestStatus,
        http: schema.merchantEndpoints.lastTestHttpStatus,
        size: schema.merchantEndpoints.lastTestResponseSize,
        latency: schema.merchantEndpoints.lastTestLatencyMs,
      })
      .from(schema.merchantEndpoints)
      .where(eq(schema.merchantEndpoints.id, endpointId));
    expect(record[0]).toMatchObject({ status: "ok", http: 200, size: 512, latency: 42 });
  });

  it("records a failure result", async () => {
    const endpointId = await seededEndpoint();
    mockRunConnectivityTest.mockResolvedValue({
      ok: false,
      status: "error:timeout",
      httpStatus: null,
      responseSize: 0,
      latencyMs: 30_015,
    });

    const state = await testConnectivityAction({}, form(endpointId));

    expect(state.success).toMatch(/error:timeout/);
    const record = await tdb.db
      .select({ status: schema.merchantEndpoints.lastTestStatus })
      .from(schema.merchantEndpoints)
      .where(eq(schema.merchantEndpoints.id, endpointId));
    expect(record[0]!.status).toBe("error:timeout");
  });

  it("does not send a credential when the mode is none", async () => {
    const other = await createEndpointDraft(
      auth,
      { ...draft, authMode: "none" },
      newPublicId(),
      vault,
    );
    mockRunConnectivityTest.mockResolvedValue({
      ok: true,
      status: "ok",
      httpStatus: 200,
      responseSize: 1,
      latencyMs: 9,
    });

    await testConnectivityAction({}, form(other.id));

    expect(mockRunConnectivityTest).toHaveBeenCalledWith({
      url: expect.any(URL),
      credential: null,
    });
  });

  it("rejects an endpoint owned by another seller", async () => {
    const otherAuth: ServiceAuth = { sellerId: OTHER, db: tdb.db };
    const foreign = await createEndpointDraft(
      otherAuth,
      { ...draft, authMode: "none" },
      newPublicId(),
      vault,
    );

    const state = await testConnectivityAction({}, form(foreign.id));

    expect(state).toEqual({ error: "Endpoint not found" });
    expect(mockRunConnectivityTest).not.toHaveBeenCalled();
  });
});