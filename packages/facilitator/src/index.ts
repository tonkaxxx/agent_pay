import { createFacilitatorApp } from "./app.js";
import { loadFacilitatorConfig } from "./config.js";
import { createMainnetFacilitator } from "./service.js";
import {
  createBaseMainnetHealthcheck,
  createMainnetFacilitatorSigner,
  facilitatorAddress,
} from "./signer.js";

async function main(): Promise<void> {
  const config = loadFacilitatorConfig();
  const signer = await createMainnetFacilitatorSigner(config);
  const facilitator = createMainnetFacilitator(signer);
  const app = createFacilitatorApp({
    facilitator,
    healthcheck: createBaseMainnetHealthcheck(config.rpcUrl),
  });

  app.listen(config.port, config.host, () => {
    process.stdout.write(
      `AgentPay facilitator listening on ${config.host}:${config.port} as ${facilitatorAddress(signer)}\n`,
    );
  });
}

main().catch(() => {
  process.stderr.write("AgentPay facilitator failed to start\n");
  process.exitCode = 1;
});
