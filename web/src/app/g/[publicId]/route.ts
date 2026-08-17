import type { NextRequest } from "next/server";

import { buildGatewayRuntime } from "@/features/gateway/gateway-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = {
  log(entry: {
    readonly requestId: string;
    readonly publicId: string;
    readonly stage: string;
    readonly status: number;
    readonly reason: string;
  }): void {
    console.info(entry);
  },
};

let runtimeFactory: (() => ReturnType<typeof buildGatewayRuntime>) | undefined;

function build():
  ReturnType<typeof buildGatewayRuntime> {
  runtimeFactory ??= () => buildGatewayRuntime(process.env, logger);
  return runtimeFactory();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  const { publicId } = await context.params;
  return build().route(publicId, request);
}