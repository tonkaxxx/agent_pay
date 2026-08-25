import type { Metadata } from "next";

import "./globals.css";

import { publicSiteUrl } from "./site-url";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: {
    default: "AgentPay — Sell APIs to autonomous agents",
    template: "%s · AgentPay",
  },
  description: "AgentPay turns HTTP 402 into autonomous, policy-controlled USDC payments for AI agents.",
  applicationName: "AgentPay",
  alternates: { canonical: "/" },
  keywords: ["HTTP 402", "AI agents", "USDC", "Base", "machine payments", "agent commerce"],
  openGraph: {
    title: "APIs can now charge themselves.",
    description: "The transaction layer for the agent economy.",
    type: "website",
    siteName: "AgentPay",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentPay — APIs can now charge themselves.",
    description: "Turn any GET API into a paid x402 endpoint on Base.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
