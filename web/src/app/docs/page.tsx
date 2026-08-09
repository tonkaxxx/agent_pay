import type { Metadata } from "next";

import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Developer Docs — AgentPay",
  description: "Call AgentPay's live Base Mainnet HTTP 402 API and run a guarded $0.01 USDC request.",
};

export default function DocumentationPage() {
  return <DocsPage />;
}
