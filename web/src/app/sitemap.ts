import type { MetadataRoute } from "next";

import { publicSiteUrl } from "./site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = publicSiteUrl();
  return [
    { url: new URL("/", siteUrl).href, changeFrequency: "weekly", priority: 1 },
    { url: new URL("/docs", siteUrl).href, changeFrequency: "monthly", priority: 0.8 },
  ];
}
