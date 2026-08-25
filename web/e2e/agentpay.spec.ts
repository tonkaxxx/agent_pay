import { decodePaymentRequiredHeader } from "@x402/core/http";
import { expect, test } from "@playwright/test";

const compactBody = {
  error: "Payment Required",
  x402Version: 2,
  priceUsdc: "0.01",
  network: "eip155:8453",
};

test("leads sellers to onboarding and exposes the compact live quote", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/AgentPay — Sell APIs to autonomous agents/);
  await expect(page.getByRole("heading", { level: 1, name: /apis can now charge themselves/i })).toBeVisible();
  await expect(page.getByText("Working MVP")).toBeVisible();
  await expect(page.getByRole("group", { name: /get started/i }).getByRole("link").first())
    .toHaveText(/start selling your api/i);
  await expect(page.getByText(/payment infrastructure for autonomous software/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^thesis$/i })).toHaveCount(0);

  await page.getByRole("tab", { name: "GET /api/premium" }).click();
  await page.getByRole("button", { name: /call live endpoint/i }).click();
  await expect(page.locator(".response-line").first()).toHaveText(/402 Payment Required/);
  await expect(page.locator(".api-console pre").first()).toContainText('"priceUsdc": "0.01"');
  await expect(page.locator(".api-console pre").nth(1)).toContainText('"amount": "10000"');
  await expect(page.locator(".api-console pre").nth(1)).not.toContainText("premiumData");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("the actual API route publishes canonical Base Mainnet x402 v2 terms", async ({ request }) => {
  const response = await request.get("/api/premium");

  expect(response.status()).toBe(402);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual(compactBody);
  const encoded = response.headers()["payment-required"];
  expect(encoded).toBeTruthy();
  const payment = decodePaymentRequiredHeader(encoded!);
  expect(payment.x402Version).toBe(2);
  expect(payment.accepts).toEqual([expect.objectContaining({
    scheme: "exact",
    network: "eip155:8453",
    amount: "10000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  })]);
  expect(JSON.stringify(payment)).not.toContain("premiumData");
  expect(JSON.stringify(payment)).not.toContain("bazaar");

  const legacyReceiptHeader = ["X", "Payment", "Tx"].join("-");
  const legacyResponse = await request.get("/api/premium", {
    headers: { [legacyReceiptHeader]: `0x${"ab".repeat(32)}` },
  });
  expect(legacyResponse.status()).toBe(402);
  expect(await legacyResponse.json()).toEqual(compactBody);
});

test("documents standard x402 access and the safe agent prompt", async ({ page }) => {
  await page.goto("/docs");

  await expect(page).toHaveTitle(/Developer Docs/);
  await expect(page.getByRole("heading", { level: 1, name: /standard x402 payments/i })).toBeVisible();
  await expect(page.getByText(/PAYMENT-SIGNATURE/).first()).toBeVisible();
  await expect(page.getByText(/YOUR_NEW_LOW_BALANCE_PRIVATE_KEY/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /pay with any capable agent/i }))
    .toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("renders a useful branded not-found page", async ({ page }) => {
  const response = await page.goto("/missing-investor-deck");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: /signal not found/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /back to agentpay/i })).toHaveAttribute("href", "/");
});
