import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";
import { getSeller, requireSeller, sellerIdFromSession } from "./dal";

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
});

afterAll(async () => {
  await tdb.close();
});

describe("sellerIdFromSession", () => {
  it("returns the id from an authenticated session", () => {
    expect(sellerIdFromSession({ user: { id: "seller-1" } })).toBe("seller-1");
  });

  it("returns null for missing or empty sessions", () => {
    expect(sellerIdFromSession(null)).toBeNull();
    expect(sellerIdFromSession({})).toBeNull();
    expect(sellerIdFromSession({ user: null })).toBeNull();
    expect(sellerIdFromSession({ user: { id: null } })).toBeNull();
    expect(sellerIdFromSession({ user: { id: "" } })).toBeNull();
  });
});

describe("getSeller", () => {
  it("returns the seller for an existing user", async () => {
    await tdb.db.insert(schema.users).values({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Seller",
      email: "seller@example.test",
    });

    const seller = await getSeller(tdb.db, "00000000-0000-0000-0000-000000000001");
    expect(seller).toEqual({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Seller",
      email: "seller@example.test",
    });
  });

  it("returns null when the user does not exist", async () => {
    expect(await getSeller(tdb.db, "00000000-0000-0000-0000-000000000099")).toBeNull();
  });
});

describe("requireSeller", () => {
  it("redirects to /login without a valid session", async () => {
    let thrown: unknown;
    try {
      await requireSeller(tdb.db, null);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(JSON.stringify(thrown)).toContain("/login");
  });

  it("redirects to /login when the user does not exist", async () => {
    let thrown: unknown;
    try {
      await requireSeller(tdb.db, { user: { id: "00000000-0000-0000-0000-000000000099" } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
  });

  it("returns the seller for a valid session", async () => {
    await tdb.db.insert(schema.users).values({
      id: "00000000-0000-0000-0000-000000000001",
      email: "seller@example.test",
    });

    const seller = await requireSeller(tdb.db, {
      user: { id: "00000000-0000-0000-0000-000000000001" },
    });
    expect(seller.email).toBe("seller@example.test");
  });
});