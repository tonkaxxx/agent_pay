import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { DocsPage } from "./docs-page";

afterEach(() => cleanup());

test("documents how to add a standard x402 v2 payment gate to a route", () => {
  render(<DocsPage />);

  expect(screen.getByRole("heading", { level: 1, name: /add an x402 v2 payment gate/i }))
    .toBeInTheDocument();
  expect(screen.getAllByText(/paymentMiddleware/).length).toBeGreaterThan(0);
  expect(screen.getByText(/pnpm add @agentpay\/server/)).toBeInTheDocument();
  for (const status of ["200", "402", "409", "425", "502"]) {
    expect(screen.getByRole("cell", { name: status })).toBeInTheDocument();
  }
  expect(screen.getAllByText(/PAYMENT-SIGNATURE/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/eip155:84532/).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: /view source on github/i })).toHaveAttribute(
    "href",
    "https://github.com/tonkaxxx/agent_pay",
  );
});

test("offers a signer-first policy example for a user's own AI agent", () => {
  render(<DocsPage />);

  expect(screen.getByRole("heading", { level: 2, name: /pay with a policy-controlled agent/i })).toBeInTheDocument();
  expect(screen.getAllByText(/ClientEvmSigner/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/onPaymentEvent/).length).toBeGreaterThan(0);
  expect(screen.getByText(/REAL FUNDS · BASE MAINNET/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /pay with your agent/i })).toHaveAttribute(
    "href",
    "#agent",
  );
});
