import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@agentpay/server": new URL("../packages/server/src/index.ts", import.meta.url).pathname,
      "next/server": new URL("./node_modules/next/server.js", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    server: { deps: { inline: ["@x402/next"] } },
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});
