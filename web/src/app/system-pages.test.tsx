import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import ErrorPage from "./error";
import NotFound from "./not-found";

test("the not-found page routes visitors back to the investor overview", () => {
  render(<NotFound />);

  expect(screen.getByRole("heading", { level: 1, name: /signal not found/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to agentpay/i })).toHaveAttribute("href", "/");
});

test("the error page can retry without exposing internal details", async () => {
  const reset = vi.fn();
  const user = userEvent.setup();
  render(<ErrorPage error={new Error("redis://user:secret@host")} reset={reset} />);

  expect(screen.queryByText(/redis:\/\/user:secret/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /try again/i }));
  expect(reset).toHaveBeenCalledOnce();
});
