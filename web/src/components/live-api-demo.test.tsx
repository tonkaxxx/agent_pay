import { encodePaymentRequiredHeader } from "@x402/core/http";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { LiveApiDemo } from "./live-api-demo";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("renders the compact body separately from decoded standard payment terms", async () => {
  const payload = {
    error: "Payment Required",
    x402Version: 2,
    priceUsdc: "0.01",
    network: "eip155:8453",
  };
  const paymentRequired = encodePaymentRequiredHeader({
    x402Version: 2,
    resource: {
      url: "https://agentpay.thebestsites.ru/api/premium",
      description: "AgentPay premium API",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    }],
    extensions: {},
  });
  const fetch = vi.fn().mockResolvedValue(Response.json(payload, {
    status: 402,
    headers: { "PAYMENT-REQUIRED": paymentRequired },
  }));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<LiveApiDemo />);

  await user.click(screen.getByRole("tab", { name: "GET /api/premium" }));
  await user.click(screen.getByRole("button", { name: /call live endpoint/i }));

  expect(fetch).toHaveBeenCalledWith("/api/premium", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  expect(await screen.findAllByText("402 Payment Required")).toHaveLength(2);
  expect(screen.getByText(/"priceUsdc": "0.01"/)).toBeInTheDocument();
  expect(screen.getByText(/Decoded PAYMENT-REQUIRED/)).toBeInTheDocument();
  expect(screen.getByText(/"amount": "10000"/)).toBeInTheDocument();
  expect(screen.getAllByText(/"network": "eip155:8453"/)).toHaveLength(2);
  expect(screen.queryByText(/premiumData/)).not.toBeInTheDocument();
  expect(screen.queryByText(/bazaar/i)).not.toBeInTheDocument();
  expect(screen.getByText(/real funds/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /complete the paid request/i })).toHaveAttribute(
    "href",
    "/docs#agent",
  );
});

test("does not invent protocol terms when the standard header is missing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    error: "Payment Required",
  }, { status: 402 })));
  const user = userEvent.setup();
  render(<LiveApiDemo />);

  await user.click(screen.getByRole("tab", { name: "GET /api/premium" }));
  await user.click(screen.getByRole("button", { name: /call live endpoint/i }));

  expect(await screen.findByText(/standard payment header unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText(/premiumData/)).not.toBeInTheDocument();
});

test("shows a safe error state when the endpoint cannot be reached", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network details")));
  const user = userEvent.setup();
  render(<LiveApiDemo />);

  await user.click(screen.getByRole("button", { name: /call live endpoint/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The live endpoint is temporarily unavailable.",
  );
  expect(screen.queryByText("network details")).not.toBeInTheDocument();
});
