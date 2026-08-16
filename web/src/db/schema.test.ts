import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TestDatabase } from "@/db/test-db";
import { createTestDatabase } from "@/db/test-db";

let tdb: TestDatabase;

beforeEach(async () => {
  tdb = await createTestDatabase();
});

afterEach(async () => {
  await tdb.close();
});

describe("migrated schema", () => {
  it("creates all Auth.js and gateway tables", async () => {
    const { rows } = await tdb.sql.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(
      [
        "account",
        "agentpay_migrations",
        "audit_event",
        "authenticator",
        "merchant_endpoint",
        "payment_event",
        "session",
        "user",
        "verificationToken",
      ].sort(),
    );
  });

  it("enforces a unique public_id on merchant_endpoint", async () => {
    await tdb.sql.query(
      'INSERT INTO "user" (id, email) VALUES (\'00000000-0000-0000-0000-000000000001\', \'owner@example.test\')',
    );
    await tdb.sql.query(
      "INSERT INTO merchant_endpoint (public_id, owner_id, display_name, upstream_url, auth_mode, pay_to, amount_atomic, status) VALUES ($1, $2, 'A', 'https://upstream.example/a', 'none', '0x0000000000000000000000000000000000000001', '1000000', 'draft')",
      ["meep-1", "00000000-0000-0000-0000-000000000001"],
    );
    await expect(
      tdb.sql.query(
        "INSERT INTO merchant_endpoint (public_id, owner_id, display_name, upstream_url, auth_mode, pay_to, amount_atomic, status) VALUES ($1, $2, 'B', 'https://upstream.example/b', 'none', '0x0000000000000000000000000000000000000001', '1000000', 'draft')",
        ["meep-1", "00000000-0000-0000-0000-000000000001"],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("allows NULL fingerprint and tx_hash but rejects duplicates among non-null", async () => {
    await tdb.sql.query(
      'INSERT INTO "user" (id, email) VALUES (\'00000000-0000-0000-0000-000000000001\', \'u1@example.test\')',
    );
    const insert = (row: string) =>
      tdb.sql.query(
        "INSERT INTO merchant_endpoint (id, public_id, owner_id, display_name, upstream_url, auth_mode, pay_to, amount_atomic, status) VALUES ($1, $2, '00000000-0000-0000-0000-000000000001', 'U', 'https://upstream.example/u', 'none', '0x0000000000000000000000000000000000000001', '1000000', 'draft')",
        [`00000000-0000-0000-0000-00000000000${row}`, `meep-${row}`],
      );
    await insert("2");
    await insert("3");

    const event = (id: string, fp: string | null, tx: string | null) =>
      tdb.sql.query(
        "INSERT INTO payment_event (id, endpoint_id, request_id, fingerprint, tx_hash, amount_atomic, commission_atomic, outcome) VALUES ($1, $2, 'req', $3, $4, '1000000', '50000', 'ok')",
        [id, "00000000-0000-0000-0000-000000000002", fp, tx],
      );

    await event("00000000-0000-0000-0000-00000000000a", "fp-1", "tx-1");
    await event("00000000-0000-0000-0000-00000000000b", null, "tx-2");
    await event("00000000-0000-0000-0000-00000000000c", "fp-2", null);

    await expect(
      event("00000000-0000-0000-0000-00000000000d", "fp-1", "tx-9"),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      event("00000000-0000-0000-0000-00000000000e", "fp-9", "tx-1"),
    ).rejects.toThrow(/duplicate key/);

    await event("00000000-0000-0000-0000-00000000000f", null, null);
  });

  it("keeps Auth.js account and authenticator uniqueness constraints", async () => {
    await tdb.sql.query(
      'INSERT INTO "user" (id, email) VALUES (\'00000000-0000-0000-0000-000000000001\', \'u2@example.test\')',
    );

    await tdb.sql.query(
      'INSERT INTO account ("userId", type, provider, "providerAccountId") VALUES (\'00000000-0000-0000-0000-000000000001\', \'oauth\', \'github\', \'gh-1\')',
    );
    await expect(
      tdb.sql.query(
        'INSERT INTO account ("userId", type, provider, "providerAccountId") VALUES (\'00000000-0000-0000-0000-000000000001\', \'oauth\', \'github\', \'gh-1\')',
      ),
    ).rejects.toThrow(/duplicate key/);

    await tdb.sql.query(
      'INSERT INTO authenticator ("credentialID", "userId", "providerAccountId", "credentialPublicKey", counter, "credentialDeviceType", "credentialBackedUp") VALUES (\'cred-1\', \'00000000-0000-0000-0000-000000000001\', \'aura\', \'pub\', 0, \'singleDevice\', true)',
    );
    await expect(
      tdb.sql.query(
        'INSERT INTO authenticator ("credentialID", "userId", "providerAccountId", "credentialPublicKey", counter, "credentialDeviceType", "credentialBackedUp") VALUES (\'cred-1\', \'00000000-0000-0000-0000-000000000001\', \'aura\', \'pub\', 0, \'singleDevice\', true)',
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("stores payment and audit events with required numeric fields", async () => {
    await tdb.sql.query(
      'INSERT INTO "user" (id, email) VALUES (\'00000000-0000-0000-0000-000000000001\', \'u3@example.test\')',
    );
    await tdb.sql.query(
      "INSERT INTO merchant_endpoint (id, public_id, owner_id, display_name, upstream_url, auth_mode, pay_to, amount_atomic, status) VALUES ('00000000-0000-0000-0000-000000000002', 'meep-s', '00000000-0000-0000-0000-000000000001', 'Store', 'https://upstream.example/s', 'none', '0x0000000000000000000000000000000000000001', '1000000', 'active')",
    );
    const { rows } = await tdb.sql.query<{
      status: string;
      auth_mode: string;
      amount_atomic: string;
      pay_to: string;
    }>(
      "SELECT status, auth_mode, amount_atomic, pay_to FROM merchant_endpoint WHERE id = '00000000-0000-0000-0000-000000000002'",
    );
    expect(rows[0]).toMatchObject({
      status: "active",
      auth_mode: "none",
      amount_atomic: "1000000",
    });
  });
});