import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
      : {}),
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "corepack pnpm dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    env: {
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      AGENTPAY_PAY_TO: "0x1111111111111111111111111111111111111111",
      REDIS_URL: "redis://127.0.0.1:6379",
      CDP_API_KEY_ID: "organizations/e2e/apiKeys/e2e",
      CDP_API_KEY_SECRET: "e2e-secret",
      AGENTPAY_OFFLINE_QUOTE_ONLY: "true",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
