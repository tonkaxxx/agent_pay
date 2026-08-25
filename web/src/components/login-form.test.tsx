import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { LoginForm } from "./login-form";

afterEach(() => cleanup());

test("presents a seller-first passwordless sign-in layout", () => {
  render(<LoginForm github email />);

  expect(screen.getByRole("heading", { level: 1, name: /turn a get endpoint into a paid surface/i })).toBeInTheDocument();
  expect(screen.queryByText(/seller access/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/sign in to configure your hosted gateway/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: /welcome back, seller/i })).toBeInTheDocument();
  expect(screen.queryByText(/agentpay seller portal/i)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute("href", "/");
  expect(screen.getByRole("list", { name: /seller onboarding steps/i })).toBeInTheDocument();
  expect(screen.getByText("Connect")).toBeInTheDocument();
  expect(screen.getByText("Configure")).toBeInTheDocument();
  expect(screen.getByText("Get paid")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: /continue with github/i })).toHaveClass(
    "login-provider-button--github",
  );
  expect(screen.getByRole("form")).toHaveClass("login-email-form");
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveClass("login-email-input");
  expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toHaveClass(
    "login-provider-button--email",
  );
  expect(screen.getByText(/passwordless access/i)).toBeInTheDocument();
});

test("keeps the email-only state intentional when GitHub is unavailable", () => {
  render(<LoginForm github={false} email />);

  expect(screen.queryByRole("button", { name: /continue with github/i })).not.toBeInTheDocument();
  expect(screen.queryByText("OR")).not.toBeInTheDocument();
  expect(screen.getByRole("form")).toHaveClass("login-email-form");
});

test("keeps the GitHub-only state intentional when email is unavailable", () => {
  render(<LoginForm github email={false} />);

  expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
  expect(screen.queryByText("OR")).not.toBeInTheDocument();
});
