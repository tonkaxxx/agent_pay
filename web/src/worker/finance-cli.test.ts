import { describe, expect, it } from "vitest";

import { parseFinanceCommand } from "./finance-cli";

describe("parseFinanceCommand", () => {
  it.each(["status", "resume", "reconcile", "run-now"] as const)("accepts %s", (command) => {
    expect(parseFinanceCommand([command])).toEqual({ command });
  });

  it("requires a reason when pausing", () => {
    expect(parseFinanceCommand(["pause", "maintenance"])).toEqual({
      command: "pause",
      reason: "maintenance",
    });
    expect(() => parseFinanceCommand(["pause"])).toThrow("invalid_arguments");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFinanceCommand(["status", "--force"])).toThrow("invalid_arguments");
  });
});
