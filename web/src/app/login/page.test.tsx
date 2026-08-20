import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("the login page resolves its authentication providers at request time", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

  expect(source).toContain('export const dynamic = "force-dynamic"');
});
