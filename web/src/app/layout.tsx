import type { Metadata } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";

import "./globals.css";

import { publicSiteUrl } from "./site-url";

const displayFont = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const bodyFont = Manrope({
  weight: "variable",
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: {
    default: "AgentPay — Payment infrastructure for autonomous software",
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
    description: "HTTP 402 payment infrastructure for autonomous software.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
