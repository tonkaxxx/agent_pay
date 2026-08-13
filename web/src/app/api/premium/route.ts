import { loadPremiumConfig } from "@/features/premium-api/config";
import { createPremiumRoute, type PremiumRequestHandler } from "@/features/premium-api/route-handler";
import { buildPremiumHandler } from "@/features/premium-api/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let handler: Promise<PremiumRequestHandler> | undefined;

function configuredHandler(): Promise<PremiumRequestHandler> {
  handler ??= Promise.resolve().then(() => buildPremiumHandler(loadPremiumConfig(process.env)));
  return handler;
}

export const GET = createPremiumRoute(configuredHandler);
