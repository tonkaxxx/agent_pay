import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";

import { LandingPage } from "./landing-page";

test("leads API sellers to onboarding while keeping proof and docs secondary", () => {
  render(<LandingPage />);

  expect(screen.getByRole("heading", { level: 1, name: /apis can now charge themselves/i }))
    .toBeInTheDocument();
  expect(screen.getByText("Working MVP")).toBeInTheDocument();
  expect(screen.getByText("USDC on Base")).toBeInTheDocument();
  expect(screen.getByText("x402 v2")).toBeInTheDocument();
  expect(screen.getByText("$0.01 / request")).toBeInTheDocument();
  expect(screen.getByText(/self-hosted settlement/i)).toBeInTheDocument();
  expect(screen.queryByText("HTTP 402 → USDC → HTTP 200")).not.toBeInTheDocument();

  const actions = within(screen.getByRole("group", { name: /get started/i })).getAllByRole("link");
  expect(actions.map((link) => link.textContent?.trim())).toEqual([
    "Start selling your API",
    "Inspect the live API",
    "Read the docs",
  ]);
  expect(actions[0]).toHaveAttribute("href", "/login");
  expect(actions[0]).toHaveClass("hero-action--seller");
  expect(actions[1]).toHaveAttribute("href", "#live-api");
  expect(actions[1]).toHaveClass("hero-action--inspect");
  expect(actions[2]).toHaveAttribute("href", "/docs");
  expect(actions[2]).toHaveClass("hero-action--docs");

  expect(screen.queryByText(/payment infrastructure for autonomous software/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^thesis$/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/software is becoming an economic actor/i)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /talk to the founder/i })).toHaveAttribute(
    "href",
    "mailto:maltsev.yar@gmail.com?subject=AgentPay%20investment%20conversation",
  );
  expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute(
    "href",
    "https://github.com/tonkaxxx/agent_pay",
  );
});
