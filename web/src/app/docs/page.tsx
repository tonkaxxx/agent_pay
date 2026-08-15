import type { Metadata } from "next";

import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Developer Docs — AgentPay",
  description: "Use standard x402 v2 clients to pay AgentPay's Base Mainnet USDC API.",
};

export default function DocumentationPage() {
  return <DocsPage />;
}
