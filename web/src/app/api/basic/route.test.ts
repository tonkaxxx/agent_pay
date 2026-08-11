import { expect, test } from "vitest";

import { GET } from "./route";

test("serves the free endpoint without any configuration", async () => {
  const response = await GET(new Request("https://agentpay.example/api/basic"));

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    basicData: "Free public data from AgentPay — no payment required.",
    tier: "free",
  });
});
