import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentPay",
    short_name: "AgentPay",
    description: "Turn any GET API into a paid x402 endpoint on Base.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2eee4",
    theme_color: "#171815",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
