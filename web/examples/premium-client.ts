import { pathToFileURL } from "node:url";

import {
  createAgentFetch,
  X402ProtocolError,
  type AgentFetchConfig,
} from "@x402/client";

import {
  authorizePremiumPayment,
  executeRequested,
  loadPremiumClientConfig,
} from "./premium-client-config.js";

type Environment = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export interface PremiumClientDependencies {
  readonly createAgentFetch: typeof createAgentFetch;
  readonly log: (message: string) => void;
}

const defaultDependencies: PremiumClientDependencies = {
  createAgentFetch,
  log: console.log,
};

export async function runPremiumClient(
  args: readonly string[],
  env: Environment,
  dependencies: PremiumClientDependencies = defaultDependencies,
): Promise<void> {
  const config = loadPremiumClientConfig(env);
  const shouldExecute = executeRequested(args);
  let previewed = false;

  const agentFetchConfig: AgentFetchConfig = {
    privateKey: config.privateKey,
    rpcUrl: config.rpcUrl,
    maxPaymentUsdc: "0.01",
    confirmations: 2,
    paymentVerificationRetries: 5,
    paymentVerificationRetryDelayMs: 2_000,
    authorizePayment: (payment) => {
      const authorized = authorizePremiumPayment(
        payment,
        config,
        shouldExecute,
        dependencies.log,
      );
      if (!authorized) previewed = true;
      return authorized;
    },
    onTransactionSubmitted: ({ hash }) => {
      dependencies.log(`Transaction submitted: ${hash}`);
      dependencies.log(`Explorer: https://basescan.org/tx/${hash}`);
      dependencies.log("WARNING: PAYMENT SUBMITTED. DO NOT RERUN THIS COMMAND.");
    },
  };

  const agentFetch = dependencies.createAgentFetch(agentFetchConfig);
  let response: Response;
  try {
    response = await agentFetch(config.apiUrl, { redirect: "error" });
  } catch (error) {
    if (error instanceof X402ProtocolError && error.code === "payment_not_authorized") {
      if (previewed && error.cause === undefined) return;
      if (error.cause instanceof Error) throw error.cause;
    }
    throw error;
  }

  if (!response.ok) throw new Error(`AgentPay API request failed with HTTP ${response.status}.`);

  dependencies.log(`Vendor API status: ${response.status}`);
  dependencies.log(JSON.stringify(await response.json()));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPremiumClient(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "AgentPay request failed.");
    process.exitCode = 1;
  });
}
