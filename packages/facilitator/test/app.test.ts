import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createFacilitatorApp, type FacilitatorApi } from "../src/app.js";

const payload = { x402Version: 2, scheme: "exact" };
const requirements = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "10000",
};

function fakeFacilitator(): FacilitatorApi {
  return {
    getSupported: vi.fn(() => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
      extensions: [],
      signers: {},
    })),
    verify: vi.fn(async () => ({ isValid: true, payer: "0x1111111111111111111111111111111111111111" })),
    settle: vi.fn(async () => ({
      success: true,
      transaction: `0x${"12".repeat(32)}`,
      network: "eip155:8453",
      payer: "0x1111111111111111111111111111111111111111",
    })),
  };
}

describe("createFacilitatorApp", () => {
  it("reports health only after the injected chain check succeeds", async () => {
    const facilitator = fakeFacilitator();
    const healthy = createFacilitatorApp({ facilitator, healthcheck: async () => true });
    const unhealthy = createFacilitatorApp({ facilitator, healthcheck: async () => false });

    await request(healthy)
      .get("/healthz")
      .expect(200, { status: "ok", network: "eip155:8453" });
    await request(unhealthy).get("/healthz").expect(503, { status: "unavailable" });
  });

  it("treats a failed healthcheck as unavailable without leaking its error", async () => {
    const app = createFacilitatorApp({
      facilitator: fakeFacilitator(),
      healthcheck: async () => {
        throw new Error("rpc-private-token");
      },
    });

    const response = await request(app).get("/healthz").expect(503);
    expect(response.body).toEqual({ status: "unavailable" });
    expect(response.text).not.toContain("rpc-private-token");
  });

  it("returns the official supported response", async () => {
    const facilitator = fakeFacilitator();
    const app = createFacilitatorApp({ facilitator, healthcheck: async () => true });

    const response = await request(app).get("/supported").expect(200);
    expect(response.body).toEqual(facilitator.getSupported());
  });

  it.each(["verify", "settle"])("delegates /%s to the official facilitator", async method => {
    const facilitator = fakeFacilitator();
    const app = createFacilitatorApp({ facilitator, healthcheck: async () => true });

    await request(app)
      .post(`/${method}`)
      .send({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements })
      .expect(200);

    expect(facilitator[method as "verify" | "settle"]).toHaveBeenCalledWith(
      payload,
      requirements,
    );
  });

  it.each([
    {},
    { x402Version: 1, paymentPayload: payload, paymentRequirements: requirements },
    { x402Version: 2, paymentPayload: null, paymentRequirements: requirements },
    { x402Version: 2, paymentPayload: payload, paymentRequirements: null },
  ])("rejects malformed requests", async body => {
    const app = createFacilitatorApp({
      facilitator: fakeFacilitator(),
      healthcheck: async () => true,
    });

    await request(app).post("/verify").send(body).expect(400, { error: "invalid_request" });
  });

  it("rejects malformed and oversized JSON with a stable JSON error", async () => {
    const app = createFacilitatorApp({
      facilitator: fakeFacilitator(),
      healthcheck: async () => true,
    });

    await request(app)
      .post("/verify")
      .set("content-type", "application/json")
      .send("{")
      .expect(400, { error: "invalid_request" });
    await request(app)
      .post("/verify")
      .send({
        x402Version: 2,
        paymentPayload: { padding: "x".repeat(70 * 1024) },
        paymentRequirements: requirements,
      })
      .expect(400, { error: "invalid_request" });
  });

  it("returns secret-free errors from facilitator failures", async () => {
    const facilitator = fakeFacilitator();
    facilitator.verify = vi.fn(async () => {
      throw new Error("private-key-material");
    });
    const app = createFacilitatorApp({ facilitator, healthcheck: async () => true });

    const response = await request(app)
      .post("/verify")
      .send({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements })
      .expect(500);
    expect(response.body).toEqual({ error: "facilitator_error" });
    expect(response.text).not.toContain("private-key-material");
  });

  it("does not expose unknown routes", async () => {
    const app = createFacilitatorApp({
      facilitator: fakeFacilitator(),
      healthcheck: async () => true,
    });

    await request(app).get("/metrics").expect(404, { error: "not_found" });
  });
});
