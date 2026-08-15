import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";

export function createMainnetFacilitator(signer: FacilitatorEvmSigner): x402Facilitator {
  return new x402Facilitator().register(
    "eip155:8453",
    new ExactEvmScheme(signer, { simulateInSettle: true }),
  );
}
