import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { LiveApiDemo } from "./live-api-demo";

afterEach(() => vi.unstubAllGlobals());

test("calls the real endpoint and renders its HTTP 402 requirements", async () => {
  const payload = {
    error: "Payment Required",
    priceUsdc: "0.01",
    payTo: "0x1111111111111111111111111111111111111111",
    network: "base",
    chainId: 8453,
  };
  const fetch = vi.fn().mockResolvedValue(Response.json(payload, { status: 402 }));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<LiveApiDemo />);

  await user.click(screen.getByRole("button", { name: /call live endpoint/i }));

  expect(fetch).toHaveBeenCalledWith("/api/premium", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  expect(await screen.findAllByText("402 Payment Required")).toHaveLength(2);
  expect(screen.getByText(/"priceUsdc": "0.01"/)).toBeInTheDocument();
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
