import { describe, expect, it, vi } from "vitest";

import { BASE_NETWORK, BASE_USDC } from "@agentpay/server";

import { createCustodialSettlementHooks } from "./hooks";

const COLLECTION = "0x1111111111111111111111111111111111111111" as const;
const SELLER = "0x2222222222222222222222222222222222222222" as const;
const PAYER = "0x3333333333333333333333333333333333333333" as const;
const RESOURCE = "https://gateway.example/g/paid-data";
const NONCE = `0x${"ab".repeat(32)}`;

const requirements = {
  scheme: "exact",
  network: BASE_NETWORK,
  asset: BASE_USDC,
  amount: "10000",
  payTo: COLLECTION,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};

const paymentPayload = {
  x402Version: 2,
  resource: { url: RESOURCE },
  accepted: requirements,
  payload: {
    signature: `0x${"cd".repeat(65)}`,
    authorization: {
      from: PAYER,
      to: COLLECTION,
      value: "10000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: NONCE,
    },
  },
  extensions: {},
};

function dependencies() {
  return {
    collectionAddress: COLLECTION,
    requestId: vi.fn(() => "request-1"),
    loadEndpoint: vi.fn(async () => ({
      id: "00000000-0000-0000-0000-000000000002",
      publicId: "paid-data",
      payTo: SELLER,
      amountAtomic: "10000",
    })),
    reserve: vi.fn(async () => undefined),
    settled: vi.fn(async () => undefined),
    cancelled: vi.fn(async () => undefined),
  };
}

function verifyContext() {
  return {
    paymentPayload,
    requirements,
    declaredExtensions: {},
    result: { isValid: true, payer: PAYER },
  };
}

describe("custodial x402 hooks", () => {
  it("creates a durable seller obligation after successful verification", async () => {
    const deps = dependencies();
    const hooks = createCustodialSettlementHooks(deps);

    await hooks.afterVerify(verifyContext() as never);

    expect(deps.loadEndpoint).toHaveBeenCalledWith("paid-data");
    expect(deps.reserve).toHaveBeenCalledWith(expect.objectContaining({
      endpointId: "00000000-0000-0000-0000-000000000002",
      requestId: "request-1",
      payerAddress: PAYER,
      authorizationNonce: NONCE,
      sellerPayTo: SELLER,
      grossAtomic: "10000",
    }));
  });

  it("leaves a successful facilitator settlement pending for confirmation reconciliation", async () => {
    const deps = dependencies();
    const hooks = createCustodialSettlementHooks(deps);

    await hooks.afterSettle({
      ...verifyContext(),
      phase: "after_handler",
      result: {
        success: true,
        transaction: `0x${"12".repeat(32)}`,
        network: BASE_NETWORK,
        payer: PAYER,
      },
    } as never);

    expect(deps.settled).not.toHaveBeenCalled();
  });

  it("releases a pending obligation when verified work is cancelled", async () => {
    const deps = dependencies();
    const hooks = createCustodialSettlementHooks(deps);

    await hooks.paymentCanceled({
      ...verifyContext(),
      phase: "after_handler",
      reason: "handler_failed",
      settledPhases: [],
    } as never);

    expect(deps.cancelled).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("fails closed when the endpoint terms no longer match", async () => {
    const deps = dependencies();
    deps.loadEndpoint.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000002",
      publicId: "paid-data",
      payTo: SELLER,
      amountAtomic: "9999",
    });
    const hooks = createCustodialSettlementHooks(deps);

    await expect(hooks.afterVerify(verifyContext() as never)).resolves.toEqual({
      abort: true,
      reason: "finance_terms_changed",
    });
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it("fails closed when the endpoint repository is unavailable", async () => {
    const deps = dependencies();
    deps.loadEndpoint.mockRejectedValue(new Error("database unavailable"));
    const hooks = createCustodialSettlementHooks(deps);

    await expect(hooks.afterVerify(verifyContext() as never)).resolves.toEqual({
      abort: true,
      reason: "finance_unavailable",
    });
    expect(deps.reserve).not.toHaveBeenCalled();
  });
});
