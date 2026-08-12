import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("premium API runtime dependencies", () => {
  it("declares the dynamically loaded x402 extensions package", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("package.json", `file://${process.cwd()}/`), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies?.["@x402/extensions"]).toBe("~2.22.0");
  });
});
