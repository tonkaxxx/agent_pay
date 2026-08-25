import type { Metadata } from "next";

import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Developer Docs — AgentPay",
  description: "Buy or sell paid GET APIs with x402 v2, Base USDC, and AgentPay's hosted GET gateway.",
};

export default function DocumentationPage() {
  return <DocsPage />;
}
