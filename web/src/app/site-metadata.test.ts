import { afterEach, expect, test, vi } from "vitest";

import { metadata } from "./layout";
import manifest from "./manifest";
import robots from "./robots";
import sitemap from "./sitemap";

afterEach(() => vi.unstubAllEnvs());

test("publishes crawl and sitemap directives for the configured public origin", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://agentpay.example");

  expect(robots()).toEqual({
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: "https://agentpay.example/sitemap.xml",
  });
  expect(sitemap()).toEqual([
    { url: "https://agentpay.example/", changeFrequency: "weekly", priority: 1 },
    { url: "https://agentpay.example/docs", changeFrequency: "monthly", priority: 0.8 },
  ]);
});

test("presents AgentPay as a seller product in browser and install metadata", () => {
  expect(metadata).toMatchObject({
    title: { default: "AgentPay — Sell APIs to autonomous agents" },
    twitter: { description: "Turn any GET API into a paid x402 endpoint on Base." },
  });
  expect(manifest()).toMatchObject({
    description: "Turn any GET API into a paid x402 endpoint on Base.",
  });
});
