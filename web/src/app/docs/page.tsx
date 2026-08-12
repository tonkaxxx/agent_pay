import type { Metadata } from "next";

import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Developer Docs — AgentPay",
  description: "Add an x402 v2 USDC payment gate with AgentPay policy, security, observability, and idempotency.",
};

export default function DocumentationPage() {
  return <DocsPage />;
}
