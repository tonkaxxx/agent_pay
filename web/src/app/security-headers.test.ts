import { expect, test } from "vitest";

import nextConfig from "../../next.config";

test("applies baseline browser security headers to every route", async () => {
  const headers = await nextConfig.headers?.();

  expect(headers).toEqual([{
    source: "/:path*",
    headers: expect.arrayContaining([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ]),
  }]);
});
