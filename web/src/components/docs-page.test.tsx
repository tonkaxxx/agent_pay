import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { DocsPage } from "./docs-page";

test("documents the real-money API and its complete response contract", () => {
  render(<DocsPage />);

  expect(screen.getByRole("heading", { level: 1, name: /ship your first paid request/i }))
    .toBeInTheDocument();
  expect(screen.getAllByText(/real funds/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/GET \/api\/premium/).length).toBeGreaterThan(0);
  for (const status of ["200", "402", "403", "503"]) {
    expect(screen.getByRole("cell", { name: status })).toBeInTheDocument();
  }
  expect(screen.getByText(/ALLOW_MAINNET_PAYMENTS=true/)).toBeInTheDocument();
  expect(screen.getByText(/transaction hash is a public bearer receipt/i)).toBeInTheDocument();
  expect(screen.getByText(/do not use this demo for secrets/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view source on github/i })).toHaveAttribute(
    "href",
    "https://github.com/tonkaxxx/agent_pay",
  );
});
