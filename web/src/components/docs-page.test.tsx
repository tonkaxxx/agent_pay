import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { DocsPage } from "./docs-page";

afterEach(() => cleanup());

test("documents how to add an HTTP 402 payment gate to a route", () => {
  render(<DocsPage />);

  expect(screen.getByRole("heading", { level: 1, name: /add a 402 payment gate/i }))
    .toBeInTheDocument();
  expect(screen.getAllByText(/paymentMiddleware/).length).toBeGreaterThan(0);
  expect(screen.getByText(/pnpm add @x402\/server/)).toBeInTheDocument();
  for (const status of ["200", "402", "403", "503"]) {
    expect(screen.getByRole("cell", { name: status })).toBeInTheDocument();
  }
  expect(screen.getAllByText(/X-Payment-Tx/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Base Sepolia/).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: /view source on github/i })).toHaveAttribute(
    "href",
    "https://github.com/tonkaxxx/agent_pay",
  );
});

test("offers a private-key prompt for paying with a user's own AI agent", () => {
  render(<DocsPage />);

  expect(screen.getByRole("heading", { level: 2, name: /pay with your own ai agent/i })).toBeInTheDocument();
  expect(screen.getByText(/agentpay\.thebestsites\.ru\/api\/premium/)).toBeInTheDocument();
  expect(screen.getAllByText(/\[INSERT_PRIVATE_KEY\]/).length).toBeGreaterThan(0);
  expect(screen.getByText(/REAL FUNDS · BASE MAINNET/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /pay with your agent/i })).toHaveAttribute(
    "href",
    "#agent",
  );
});