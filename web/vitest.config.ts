import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@x402/server": new URL("../packages/server/src/index.ts", import.meta.url).pathname,
      "@x402/client": new URL("../packages/client/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "examples/**/*.test.ts"],
    clearMocks: true,
  },
});
