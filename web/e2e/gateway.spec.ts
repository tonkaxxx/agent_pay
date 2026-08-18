import { expect, test, type Page } from "@playwright/test";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3100";
const MAILBOX_DIR = path.join(import.meta.dirname, ".tmp");
const UPSTREAM_URL = "https://1.1.1.7/live";
const PAYOUT = "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB";

test("seller completes the hosted gateway lifecycle and other users are denied", async ({
  page,
  browser,
}) => {
  await signInWithGitHub(page);

  await createEndpoint(page, {
    displayName: "Weather API",
    authMode: "bearer",
    credential: "sk-live-bearer-test-12345",
  });

  const endpointId = pathFromUrl(page.url());
  expect(endpointId).toBeTruthy();

  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Bearer token upstream · 0\.01 USDC per request/)).toBeVisible();

  await testUpstreamConnection(page);
  await expect(page.getByRole("status")).toContainText("Upstream answered HTTP 200");

  await page.getByRole("button", { name: "Activate endpoint" }).click();
  await expect(page.getByText("Your paid gateway URL")).toBeVisible();
  await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
  const gatewayCode = page.locator("code").filter({ hasText: "/g/" });
  await expect(gatewayCode).toBeVisible();
  await expect(gatewayCode).toHaveText(new RegExp(`${BASE_URL.replace("/", "\\/")}/g/.+`));
  const gatewayUrl = (await gatewayCode.textContent())!;

  const signature = paymentHeader(gatewayUrl);
  const paid = await page.request.get(gatewayUrl, {
    headers: { "PAYMENT-SIGNATURE": signature },
  });
  expect(paid.status()).toBe(200);
  expect(await paid.json()).toEqual({ status: "ok" });
  expect(paid.headers()["payment-response"]).toBeTruthy();

  const replay = await page.request.get(gatewayUrl, {
    headers: { "PAYMENT-SIGNATURE": signature },
  });
  expect(replay.status()).toBe(409);
  expect(await replay.json()).toEqual({ error: "Conflict", reason: "payment_consumed" });

  await page.reload();
  await expect(metricValue(page, "Paid requests")).toHaveText("1");
  await expect(metricValue(page, "GMV")).toHaveText("0.01 USDC");
  await expect(metricValue(page, "AgentPay commission (5%)")).toHaveText("0.0005 USDC");

  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  for (const label of [
    "Paid requests",
    "GMV",
    "AgentPay commission (5%)",
    "Unique payers",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Pause endpoint" }).click();
  await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate endpoint" })).toBeVisible();

  await page.locator("#credential").fill("sk-live-bearer-rotated-67890");
  await page.getByRole("button", { name: "Rotate credential" }).click();
  await expect(page.locator("#credential")).toHaveValue("");
  await testUpstreamConnection(page);
  await expect(page.getByRole("status")).toContainText("Upstream answered HTTP 200");

  await expect(page).toHaveURL(new RegExp(`/dashboard/${endpointId}$`));
  await expect(page).not.toHaveURL(/\/login/);

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const email = uniqueEmail();
  try {
    await signInWithEmail(otherPage, email);
    const response = await otherPage.goto(`/dashboard/${endpointId}`);
    expect(response?.status()).toBe(404);
    await expect(otherPage.getByRole("heading", { level: 1, name: /signal not found/i })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test("email sign-in boundary works and an X-API-Key draft can be configured", async ({
  page,
}) => {
  const email = uniqueEmail();
  await signInWithEmail(page, email);

  await page.goto("/dashboard/new");
  await page.locator("#displayName").fill("Internal dashboard");
  await page.locator("#upstreamUrl").fill(UPSTREAM_URL);
  await page.locator("#authMode").selectOption("x-api-key");
  await page.locator("#credential").fill("xapikey-test-abc-123");
  await page.locator("#payTo").fill(PAYOUT);
  await page.getByRole("button", { name: "Create draft endpoint" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Internal dashboard" })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/X-API-Key upstream · 0\.01 USDC per request/)).toBeVisible();

  await testUpstreamConnection(page);
  await expect(page.getByRole("status")).toContainText("Upstream answered HTTP 200");

  await expect(page.getByRole("button", { name: "Activate endpoint" })).toBeVisible();
});

async function signInWithGitHub(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Your endpoints" })).toBeVisible();
  await expect(page.getByText("Signed in as seller@agentpay.test")).toBeVisible();
}

async function signInWithEmail(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
  const mail = await waitForMailbox(email);
  const magicLink = mail.match(/http:\/\/localhost:3100\/api\/auth\/callback\/nodemailer\?[^\s"']+/)?.[0];
  expect(magicLink).toBeTruthy();
  await page.evaluate((url) => {
    window.location.assign(url);
  }, magicLink!).catch(() => undefined);
  await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Your endpoints" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}

interface EndpointOptions {
  readonly displayName: string;
  readonly authMode: "bearer" | "x-api-key";
  readonly credential: string;
}

async function createEndpoint(page: Page, options: EndpointOptions): Promise<void> {
  await page.goto("/dashboard/new");
  await page.locator("#displayName").fill(options.displayName);
  await page.locator("#upstreamUrl").fill(UPSTREAM_URL);
  await page.locator("#authMode").selectOption(options.authMode);
  await page.locator("#credential").fill(options.credential);
  await page.locator("#payTo").fill(PAYOUT);
  await page.getByRole("button", { name: "Create draft endpoint" }).click();
  await expect(page.getByRole("heading", { level: 1, name: options.displayName })).toBeVisible();
}

async function testUpstreamConnection(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Test upstream connection" }).click();
  await expect(page.getByRole("status")).toContainText("Upstream answered HTTP 200", {
    timeout: 20_000,
  });
}

function pathFromUrl(url: string): string {
  const match = /\/dashboard\/([^/?#]+)/.exec(url);
  return match?.[1] ?? "";
}

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@agentpay.test`;
}

function mailboxFile(email: string): string {
  const safe = email.replace(/[^a-z0-9._-]/gi, "_");
  return path.join(MAILBOX_DIR, `mailbox-${safe}.eml`);
}

async function waitForMailbox(email: string, timeoutMs = 20_000): Promise<string> {
  const file = mailboxFile(email);
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file)) {
    if (Date.now() > deadline) {
      throw new Error(`mailbox file never appeared for ${email}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return decodeQuotedPrintable(readFileSync(file, "utf8"));
}

function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function metricValue(page: Page, label: string) {
  return page.locator("section").filter({ hasText: label }).locator("span").first();
}

function paymentHeader(resource: string): string {
  const nonce = createHash("sha256").update(resource).digest("hex");
  const payment: PaymentPayload = {
    x402Version: 2,
    resource: { url: resource },
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "10000",
      payTo: PAYOUT,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    },
    payload: {
      signature: `0x${"cd".repeat(65)}`,
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: PAYOUT,
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${nonce}`,
      },
    },
    extensions: {},
  };
  return encodePaymentSignatureHeader(payment);
}
