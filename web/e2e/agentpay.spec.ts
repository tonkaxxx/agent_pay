import { expect, test } from "@playwright/test";
import { decodePaymentRequiredHeader } from "@x402/core/http";

test("presents the investor story and exposes the live payment quote", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/AgentPay — Payment infrastructure/);
  await expect(page.getByRole("heading", { level: 1, name: /apis can now charge themselves/i })).toBeVisible();
  await expect(page.getByText("Working MVP")).toBeVisible();
  await expect(page.getByRole("link", { name: /talk to the founder/i })).toHaveAttribute(
    "href",
    "mailto:maltsev.yar@gmail.com?subject=AgentPay%20investment%20conversation",
  );

  await page.getByRole("tab", { name: /api\/premium/i }).click();
  await page.getByRole("button", { name: /call live endpoint/i }).click();
  await expect(page.locator(".response-line")).toHaveText(/402 Payment Required/);
  await expect(page.locator(".api-console pre")).toContainText('"amount": "10000"');
  await expect(page.locator(".api-console pre")).toContainText('"network": "eip155:8453"');

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("the actual API route publishes exact Base Mainnet requirements", async ({ request }) => {
  const response = await request.get("/api/premium");

  expect(response.status()).toBe(402);
  const encoded = response.headers()["payment-required"];
  expect(encoded).toBeTruthy();
  expect(decodePaymentRequiredHeader(encoded!)).toMatchObject({
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      amount: "10000",
      payTo: "0x1111111111111111111111111111111111111111",
      network: "eip155:8453",
    }],
  });
});

test("documents the 402 payment gate", async ({ page }) => {
  await page.goto("/docs");

  await expect(page).toHaveTitle(/Developer Docs/);
  await expect(page.getByRole("heading", { level: 1, name: /add an x402 v2 payment gate to any route/i })).toBeVisible();
  await expect(page.getByText(/paymentMiddleware/)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: /pay with a policy-controlled agent/i }),
  ).toBeVisible();

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
