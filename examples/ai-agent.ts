import "dotenv/config";

import { pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

import {
  createAgentFetch,
  USDC_BASE_SEPOLIA,
  X402ProtocolError,
  type AgentFetchConfig,
} from "@x402/client";

import {
  DEMO_PRICE_USDC,
  executeRequested,
  loadDemoEnvironment,
  validatedPrivateKey,
  vendorApiUrlFromEnvironment,
  type DemoMode,
} from "./demo-config.js";
import {
  MainnetPreflightError,
  authorizeMainnetPayment,
  createMainnetPreflightRuntime,
} from "./mainnet-preflight.js";

export interface AgentDemoDependencies {
  createAgentFetch: typeof createAgentFetch;
  createMainnetPreflightRuntime: typeof createMainnetPreflightRuntime;
  log(message: string): void;
}

const defaultAgentDemoDependencies: AgentDemoDependencies = {
  createAgentFetch,
  createMainnetPreflightRuntime,
  log: console.log,
};

export async function runAgentDemo(
  mode: DemoMode,
  args: readonly string[],
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  dependencies: AgentDemoDependencies = defaultAgentDemoDependencies,
): Promise<void> {
  const environment = loadDemoEnvironment(mode, env);
  const privateKey = validatedPrivateKey(env.AGENT_PRIVATE_KEY);
  const vendorApiUrl = vendorApiUrlFromEnvironment(environment, env);
  let successfulPreview = false;

  let agentFetchConfig: AgentFetchConfig = {
    privateKey,
    rpcUrl: environment.rpcUrl,
    maxPaymentUsdc: "0.10",
    authorizePayment: (context) => context.chainId === 84532
      && context.network === "base-sepolia"
      && context.token === USDC_BASE_SEPOLIA,
  };

  if (environment.network.realFunds) {
    const agentAddress = privateKeyToAccount(privateKey).address;
    const runtime = dependencies.createMainnetPreflightRuntime(environment.rpcUrl);
    agentFetchConfig = {
      privateKey,
      rpcUrl: environment.rpcUrl,
      maxPaymentUsdc: DEMO_PRICE_USDC,
      authorizePayment: async (context) => {
        const authorized = await authorizeMainnetPayment({
          context,
          runtime,
          agentAddress,
          expectedPayTo: environment.vendorWalletAddress,
          expectedRequestUrl: vendorApiUrl,
          executeRequested: executeRequested(args),
          mainnetAllowed: environment.mainnetAllowed,
          log: dependencies.log,
        });
        if (!authorized) successfulPreview = true;
        return authorized;
      },
      onTransactionSubmitted: ({ hash }) => {
        dependencies.log(`Transaction submitted: ${hash}`);
        dependencies.log(`Explorer: ${environment.network.explorerUrl}/tx/${hash}`);
        dependencies.log("WARNING: PAYMENT SUBMITTED. DO NOT RERUN THIS COMMAND.");
      },
    };
  }

  const agentFetch = dependencies.createAgentFetch(agentFetchConfig);

  let response: Response;
  try {
    response = environment.network.realFunds
      ? await agentFetch(vendorApiUrl, { redirect: "error" })
      : await agentFetch(vendorApiUrl);
  } catch (error) {
    if (error instanceof X402ProtocolError && error.code === "payment_not_authorized") {
      if (error.cause instanceof MainnetPreflightError) throw error.cause;
      if (successfulPreview && error.cause === undefined) return;
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Vendor API request failed with HTTP ${response.status}.`);
  }

  dependencies.log(`Vendor API status: ${response.status}`);
  dependencies.log(JSON.stringify(await response.json()));
}

export function runDefaultAgentDemo(
  args: readonly string[],
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  dependencies: AgentDemoDependencies = defaultAgentDemoDependencies,
): Promise<void> {
  return runAgentDemo("sepolia", args, env, dependencies);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runDefaultAgentDemo(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Agent request failed.");
    process.exitCode = 1;
  });
}
