import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { DocsPage } from "./docs-page";

afterEach(() => cleanup());

test("documents the standard self-hosted x402 v2 flow", () => {
  const { container } = render(<DocsPage />);
  const text = container.textContent ?? "";

  expect(screen.getByRole("heading", { level: 1, name: /standard x402 payments/i }))
    .toBeInTheDocument();
  for (const header of ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"]) {
    expect(text).toContain(header);
  }
  expect(text).toContain("eip155:8453");
  expect(text).toContain("0.01 USDC");
  expect(text).toMatch(/self-hosted facilitator/i);
  expect(text).toMatch(/gas sponsor/i);
  expect(text).toMatch(/no buyer RPC or ETH/i);
  expect(text).not.toMatch(/X-Payment-Tx/i);
  expect(text).not.toMatch(/CDP/i);
  expect(text).not.toMatch(/Sepolia/i);
  expect(screen.getByRole("link", { name: /view source on github/i })).toHaveAttribute(
    "href",
    "https://github.com/tonkaxxx/agent_pay",
  );
});

test("offers the exact safe one-prompt example and states the agent capability boundary", () => {
  const { container } = render(<DocsPage />);
  const text = container.textContent ?? "";

  expect(screen.getByRole("heading", { level: 2, name: /pay with any capable agent/i }))
    .toBeInTheDocument();
  expect(text).toContain("here is crypto wallet private key:");
  expect(text).toContain("AGENT_PRIVATE_KEY=<YOUR_NEW_LOW_BALANCE_PRIVATE_KEY>");
  expect(text).toContain("https://agentpay.thebestsites.ru/api/premium");
  expect(text).toMatch(/execute code and make outbound HTTPS requests/i);
  expect(text).toMatch(/text-only agent cannot/i);
  expect(text).not.toMatch(/AGENT_PRIVATE_KEY=0x[0-9a-fA-F]{64}/);
  expect(screen.getByText(/REAL FUNDS · BASE MAINNET/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /pay with an agent/i })).toHaveAttribute(
    "href",
    "#agent",
  );
});
