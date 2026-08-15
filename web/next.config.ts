import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const release = process.env.AGENTPAY_RELEASE;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  ...(release ? {
    deploymentId: release,
    generateBuildId: async () => release,
  } : {}),
  transpilePackages: ["@agentpay/server"],
  typedRoutes: true,
  headers: async () => [{
    source: "/:path*",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  }],
};

export default nextConfig;
