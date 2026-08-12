import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

import { LiveApiDemo } from "./live-api-demo";

afterEach(() => vi.unstubAllGlobals());

test("calls the real endpoint and renders its HTTP 402 requirements", async () => {
  const payload: PaymentRequired = {
    x402Version: 2,
    resource: { url: "https://agentpay.example/api/premium", description: "Premium" },
    accepts: [{
      scheme: "exact",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x1111111111111111111111111111111111111111",
      network: "eip155:8453",
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    }],
  };
  const fetch = vi.fn().mockResolvedValue(new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(payload) },
  }));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<LiveApiDemo />);

  await user.click(screen.getByRole("tab", { name: /api\/premium/i }));
  await user.click(screen.getByRole("button", { name: /call live endpoint/i }));

  expect(fetch).toHaveBeenCalledWith("/api/premium", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  expect(await screen.findAllByText("402 Payment Required")).toHaveLength(2);
  expect(screen.getByText(/"amount": "10000"/)).toBeInTheDocument();
  expect(screen.getByText(/real funds/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /complete the paid request/i })).toHaveAttribute(
    "href",
    "/docs#agent",
  );
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
