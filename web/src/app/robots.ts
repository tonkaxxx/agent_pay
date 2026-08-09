import type { MetadataRoute } from "next";

import { publicSiteUrl } from "./site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: new URL("/sitemap.xml", publicSiteUrl()).href,
  };
}
