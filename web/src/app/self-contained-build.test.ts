import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

test("does not require remote font downloads during production builds", () => {
  const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
  expect(layout).not.toContain("next/font/google");
  expect(layout).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
});
