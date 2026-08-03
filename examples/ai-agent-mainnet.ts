import { pathToFileURL } from "node:url";

import {
  runAgentDemo,
  type AgentDemoDependencies,
} from "./ai-agent.js";

type Environment = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export function runMainnetAgentDemo(
  args: readonly string[],
  env: Environment,
  dependencies?: AgentDemoDependencies,
): Promise<void> {
  return dependencies === undefined
    ? runAgentDemo("mainnet", args, env)
    : runAgentDemo("mainnet", args, env, dependencies);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runMainnetAgentDemo(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Agent request failed.");
    process.exitCode = 1;
  });
}
