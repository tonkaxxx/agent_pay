import type { Metadata } from "next";

import { DocsPage } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Developer Docs — AgentPay",
  description: "Add an HTTP 402 USDC payment gate to any API route with @x402/server paymentMiddleware.",
};

export default function DocumentationPage() {
  return <DocsPage />;
}
