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
    baseURL: "http://localhost:3100",
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
      command: "node e2e/e2e-stack.mjs",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
