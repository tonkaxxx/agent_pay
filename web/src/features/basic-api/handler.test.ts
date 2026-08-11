import { expect, test } from "vitest";

import { createBasicHandler } from "./handler";

test("returns free data without any payment header", async () => {
  const handle = createBasicHandler();

  const response = await handle(new Request("https://agentpay.example/api/basic"));

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    basicData: "Free public data from AgentPay — no payment required.",
    tier: "free",
  });
});
