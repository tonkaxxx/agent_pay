import { pathToFileURL } from "node:url";

import {
  createVendorApp,
  createVendorFacilitator,
  startVendorApp,
  vendorRuntimeConfiguration,
} from "./vendor-api.js";

type Environment = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export function mainnetVendorRuntimeConfiguration(
  _args: readonly string[],
  env: Environment,
) {
  return vendorRuntimeConfiguration("mainnet", env);
}

export function runMainnetVendorDemo(args: readonly string[], env: Environment): void {
  const config = mainnetVendorRuntimeConfiguration(args, env);
  startVendorApp(config, createVendorApp(config, createVendorFacilitator("mainnet", process.env)), console.log);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runMainnetVendorDemo(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start Vendor API.");
    process.exitCode = 1;
  }
}
