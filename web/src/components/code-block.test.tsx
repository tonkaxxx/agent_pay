import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { CodeBlock } from "./code-block";

test("copies the displayed command and confirms the action", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  render(<CodeBlock label="Terminal" code="curl https://agentpay.example/api/premium" />);

  await user.click(screen.getByRole("button", { name: /copy terminal/i }));

  expect(writeText).toHaveBeenCalledWith("curl https://agentpay.example/api/premium");
  expect(screen.getByRole("button", { name: /copied terminal/i })).toBeInTheDocument();
});
