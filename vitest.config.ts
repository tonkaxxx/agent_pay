import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agentpay/server": fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
    clearMocks: true,
  },
});
