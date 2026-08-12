import {
  type FacilitatorClient,
  type RouteConfig,
  x402ResourceServer,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  declarePaymentIdentifierExtension,
  extractAndValidatePaymentIdentifier,
  isPaymentIdentifierRequired,
  PAYMENT_IDENTIFIER,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { formatUnits, getAddress, parseUnits, type Address } from "viem";

export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_BASE_SEPOLIA: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export type AgentPayNetwork = "eip155:8453" | "eip155:84532";

export interface CreateAgentPayServerOptions {
  readonly facilitator: FacilitatorClient;
  readonly networks: readonly [AgentPayNetwork, ...AgentPayNetwork[]];
}

export interface CreateAgentPayRouteOptions {
  readonly network: AgentPayNetwork;
  readonly priceUsdc: string;
  readonly payTo: Address;
  readonly description: string;
  readonly mimeType?: string;
  readonly paymentIdentifier?: "optional" | "required" | false;
  readonly discovery?: { readonly outputExample: unknown };
}

const supportedNetworks = new Set<AgentPayNetwork>(["eip155:8453", "eip155:84532"]);
const usdcPricePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

function assertNetwork(network: unknown): asserts network is AgentPayNetwork {
  if (typeof network !== "string" || !supportedNetworks.has(network as AgentPayNetwork)) {
    throw new RangeError(`Unsupported AgentPay network: ${String(network)}.`);
  }
}

function normalizedPrice(priceUsdc: string): string {
  if (!usdcPricePattern.test(priceUsdc)) {
    throw new RangeError("priceUsdc must be a positive USDC amount with at most six decimals.");
  }
  const amount = parseUnits(priceUsdc, 6);
  if (amount <= 0n) {
    throw new RangeError("priceUsdc must be greater than zero.");
  }
  return formatUnits(amount, 6);
}

export function createAgentPayResourceServer({
  facilitator,
  networks,
}: CreateAgentPayServerOptions): x402ResourceServer {
  if (!facilitator || typeof facilitator.verify !== "function"
    || typeof facilitator.settle !== "function"
    || typeof facilitator.getSupported !== "function") {
    throw new TypeError("facilitator must implement FacilitatorClient.");
  }
  if (!Array.isArray(networks) || networks.length === 0) {
    throw new RangeError("networks must contain at least one supported CAIP-2 network.");
  }

  const server = new x402ResourceServer(facilitator)
    .registerExtension(paymentIdentifierResourceServerExtension)
    .registerExtension(bazaarResourceServerExtension);

  server.onBeforeVerify(async ({ paymentPayload, declaredExtensions }) => {
    const declaration = declaredExtensions[PAYMENT_IDENTIFIER];
    if (declaration === undefined) return;
    const { id, validation } = extractAndValidatePaymentIdentifier(
      paymentPayload as Parameters<typeof extractAndValidatePaymentIdentifier>[0],
    );
    if (!validation.valid) {
      return {
        abort: true,
        reason: "invalid_payment_identifier",
        ...(validation.errors === undefined
          ? {}
          : { message: validation.errors.join("; ") }),
      };
    }
    if (isPaymentIdentifierRequired(declaration) && id === null) {
      return {
        abort: true,
        reason: "payment_identifier_required",
        message: "This route requires a valid Payment Identifier.",
      };
    }
  });

  const registered = new Set<AgentPayNetwork>();
  for (const network of networks) {
    assertNetwork(network);
    if (registered.has(network)) continue;
    registered.add(network);
    server.register(network, new ExactEvmScheme());
  }

  return server;
}

export function createAgentPayRoute({
  network,
  priceUsdc,
  payTo,
  description,
  mimeType,
  paymentIdentifier = "optional",
  discovery,
}: CreateAgentPayRouteOptions): RouteConfig {
  assertNetwork(network);
  const price = normalizedPrice(priceUsdc);

  let recipient: Address;
  try {
    recipient = getAddress(payTo);
  } catch (cause) {
    throw new TypeError("payTo must be a valid EVM address.", { cause });
  }
  if (description.trim() === "") {
    throw new TypeError("description must not be empty.");
  }

  const extensions: Record<string, unknown> = {};
  if (paymentIdentifier !== false) {
    extensions[PAYMENT_IDENTIFIER] = declarePaymentIdentifierExtension(
      paymentIdentifier === "required",
    );
  }
  if (discovery !== undefined) {
    Object.assign(extensions, declareDiscoveryExtension({
      output: { example: discovery.outputExample },
    }));
  }

  return {
    accepts: {
      scheme: "exact",
      network,
      price: `$${price}`,
      payTo: recipient,
    },
    description,
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(Object.keys(extensions).length === 0 ? {} : { extensions }),
  };
}
