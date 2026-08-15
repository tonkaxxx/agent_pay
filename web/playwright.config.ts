import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

process.env.NO_PROXY ??= "127.0.0.1,localhost";
process.env.no_proxy ??= process.env.NO_PROXY;
const nixosChromium = "/run/current-system/sw/bin/chromium";
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync(nixosChromium) ? nixosChromium : undefined);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...(chromiumExecutable
      ? { launchOptions: { executablePath: chromiumExecutable } }
      : {}),
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node e2e/fake-facilitator.mjs",
      url: "http://127.0.0.1:4022/healthz",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "corepack pnpm dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      env: {
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
        AGENTPAY_PAY_TO: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
        FACILITATOR_URL: "http://127.0.0.1:4022",
        REDIS_URL: "redis://127.0.0.1:6379",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
