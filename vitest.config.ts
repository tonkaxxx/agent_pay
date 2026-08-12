import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agentpay/server": fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
      "@agentpay/client": fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
    clearMocks: true,
  },
});
