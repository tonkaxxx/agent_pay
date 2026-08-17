import { describe, expect, it, vi } from "vitest";

import {
  commissionAtomic,
  parseReconcileArgs,
  reconcilePayment,
} from "./reconcile-payment.mjs";

interface ReconcileDependencies {
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  verifyReceipt(request: {
    txHash: string;
    payTo: string;
    amountAtomic: string;
  }): Promise<{ payerAddress: string; amountAtomic: string }>;
}

const ENDPOINT_ID = "1b4e28ba-2fa1-4d9e-8d1e-5f2a1b3c4d5e";
const REQUEST_ID = "req-42";
const TX_HASH = "0x" + "a".repeat(64);
const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ENDPOINT_ID,
    pay_to: PAY_TO,
    amount_atomic: "1234500",
    ...overrides,
  };
}

function dependencies(
  {
    endpoint = [row()],
    existing = [],
    verifyReceipt = vi.fn(async () => ({ payerAddress: PAY_TO, amountAtomic: "1234500" })),
  }: {
    endpoint?: Record<string, unknown>[];
    existing?: Record<string, unknown>[];
    verifyReceipt?: ReconcileDependencies["verifyReceipt"];
  } = {},
): ReconcileDependencies {
  const inserted: unknown[] = [];
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM merchant_endpoint")) return endpoint;
      if (sql.includes("FROM payment_event")) return existing;
      if (sql.includes("INSERT INTO payment_event")) {
        inserted.push(params);
      }
      return [];
    }),
    verifyReceipt,
  };
}

describe("commissionAtomic", () => {
  it("computes 5% of the atomic amount", () => {
    expect(commissionAtomic("1000000")).toBe("50000");
    expect(commissionAtomic("1234500")).toBe("61725");
  });
});

describe("parseReconcileArgs", () => {
  it("parses required identifiers", () => {
    expect(parseReconcileArgs([
      "--request-id=req-42",
      "--endpoint-id=1b4e28ba-2fa1-4d9e-8d1e-5f2a1b3c4d5e",
      "--tx-hash=0x" + "a".repeat(64),
    ])).toEqual({
      requestId: "req-42",
      endpointId: ENDPOINT_ID,
      txHash: TX_HASH,
    });
  });

  it("rejects missing arguments", () => {
    expect(() => parseReconcileArgs(["--request-id=req-42"])).toThrow("invalid_arguments");
  });
});

describe("reconcilePayment", () => {
  it("verifies the receipt and inserts a missing settled event", async () => {
    const deps = dependencies();
    const result = await reconcilePayment(
      { requestId: REQUEST_ID, endpointId: ENDPOINT_ID, txHash: TX_HASH },
      deps,
    );

    expect(result.status).toBe("recorded");
    expect(deps.verifyReceipt).toHaveBeenCalledWith({
      txHash: TX_HASH,
      payTo: PAY_TO,
      amountAtomic: "1234500",
    });
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_event"),
      expect.arrayContaining([REQUEST_ID, ENDPOINT_ID, TX_HASH, "1234500", "61725"]),
    );
  });

  it("is idempotent when the transaction is already recorded", async () => {
    const deps = dependencies({ existing: [{ id: "existing" }] });
    const result = await reconcilePayment(
      { requestId: REQUEST_ID, endpointId: ENDPOINT_ID, txHash: TX_HASH },
      deps,
    );

    expect(result.status).toBe("already_recorded");
    expect(deps.verifyReceipt).not.toHaveBeenCalled();
  });

  it("reports an unknown endpoint", async () => {
    const deps = dependencies({ endpoint: [] });
    const result = await reconcilePayment(
      { requestId: REQUEST_ID, endpointId: ENDPOINT_ID, txHash: TX_HASH },
      deps,
    );

    expect(result.status).toBe("endpoint_not_found");
    expect(deps.verifyReceipt).not.toHaveBeenCalled();
  });

  it("refuses to insert when the onchain amount does not match", async () => {
    const deps = dependencies({
      verifyReceipt: vi.fn(async () => ({ payerAddress: PAY_TO, amountAtomic: "999999" })),
    });
    const result = await reconcilePayment(
      { requestId: REQUEST_ID, endpointId: ENDPOINT_ID, txHash: TX_HASH },
      deps,
    );

    expect(result.status).toBe("amount_mismatch");
    expect(deps.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_event"),
      expect.anything(),
    );
  });
});
