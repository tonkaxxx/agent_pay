import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { LandingPage } from "./landing-page";

test("presents AgentPay as working payment infrastructure for autonomous software", () => {
  render(<LandingPage />);

  expect(screen.getByRole("heading", { level: 1, name: /apis can now charge themselves/i }))
    .toBeInTheDocument();
  expect(screen.getByText("Working MVP")).toBeInTheDocument();
  expect(screen.getByText("USDC on Base")).toBeInTheDocument();
  expect(screen.getByText("x402 v2")).toBeInTheDocument();
  expect(screen.getByText("$0.01 / request")).toBeInTheDocument();
  expect(screen.getByText(/policy, security and observability layer/i)).toBeInTheDocument();
  expect(screen.getByText(/self-hosted settlement/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /read the docs/i })).toHaveAttribute("href", "/docs");
  expect(screen.getByRole("link", { name: /talk to the founder/i })).toHaveAttribute(
    "href",
    "mailto:maltsev.yar@gmail.com?subject=AgentPay%20investment%20conversation",
  );
  expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute(
    "href",
    "https://github.com/tonkaxxx/agent_pay",
  );
});
