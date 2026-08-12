import type { FacilitatorClient } from "@x402/core/server";

import {
  createAgentPayResourceServer,
  createAgentPayRoute,
  type AgentPayNetwork,
} from "../src/index.js";

declare const facilitator: FacilitatorClient;

const networks = ["eip155:8453", "eip155:84532"] as const satisfies readonly [
  AgentPayNetwork,
  ...AgentPayNetwork[],
];

const server = createAgentPayResourceServer({ facilitator, networks });
const route = createAgentPayRoute({
  network: "eip155:84532",
  priceUsdc: "0.01",
  payTo: "0x1111111111111111111111111111111111111111",
  description: "Typed route",
});

// @ts-expect-error Ethereum mainnet is outside the AgentPay v2 Base-only boundary.
createAgentPayRoute({ network: "eip155:1", priceUsdc: "0.01", payTo: route.accepts, description: "bad" });

void [server, route];
