#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { decodePaymentRequiredHeader } from "@x402/core/http";

const BASE_NETWORK = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRIVATE_KEY_PATTERN = /0x[0-9a-fA-F]{64}/;
const IMMUTABLE_TAG_PATTERN = /:[0-9a-f]{40}$/;
const IMMUTABLE_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/;
const directory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(directory, "..");

function fail(reason) {
  throw new Error(reason);
}

export function validateImageReference(image) {
  if (typeof image !== "string" ||
    (!IMMUTABLE_TAG_PATTERN.test(image) && !IMMUTABLE_DIGEST_PATTERN.test(image))) {
    fail("immutable_image_required");
  }
  return image;
}

function canonicalBaseUrl(value) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) {
      fail("unpaid_contract_invalid");
    }
    return url.href.replace(/\/$/, "");
  } catch {
    fail("unpaid_contract_invalid");
  }
}

function equalAddress(actual, expected) {
  return typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();
}

export function validateUnpaidContract(input) {
  try {
    const expectedBaseUrl = canonicalBaseUrl(input.baseUrl);
    const expectedResource = `${expectedBaseUrl}/api/premium`;
    const body = input.body;
    if (input.status !== 402 || !body || typeof body !== "object" || Array.isArray(body)) {
      fail("unpaid_contract_invalid");
    }
    const keys = Object.keys(body).sort();
    if (JSON.stringify(keys) !== JSON.stringify([
      "error",
      "network",
      "priceUsdc",
      "x402Version",
    ])) {
      fail("unpaid_contract_invalid");
    }
    if (body.error !== "Payment Required" || body.x402Version !== 2 ||
      body.priceUsdc !== "0.01" || body.network !== BASE_NETWORK) {
      fail("unpaid_contract_invalid");
    }

    const payment = decodePaymentRequiredHeader(input.paymentRequired);
    const accepted = payment.accepts?.[0];
    if (payment.x402Version !== 2 || payment.resource?.url !== expectedResource ||
      payment.accepts?.length !== 1 || !accepted ||
      accepted.scheme !== "exact" || accepted.network !== BASE_NETWORK ||
      accepted.amount !== "10000" || !equalAddress(accepted.asset, BASE_USDC) ||
      !equalAddress(accepted.payTo, input.payTo) ||
      accepted.maxTimeoutSeconds !== 300 ||
      Object.keys(payment.extensions ?? {}).length !== 0) {
      fail("unpaid_contract_invalid");
    }
    if (PRIVATE_KEY_PATTERN.test(JSON.stringify({ body, payment }))) {
      fail("unpaid_contract_invalid");
    }
    return {
      resource: expectedResource,
      network: BASE_NETWORK,
      amount: "10000",
      asset: BASE_USDC,
      payTo: accepted.payTo,
    };
  } catch {
    fail("unpaid_contract_invalid");
  }
}

function parseArguments(args) {
  const options = {
    local: false,
    baseUrl: undefined,
    composeFile: undefined,
    envFile: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--local") {
      options.local = true;
      continue;
    }
    const assigned = argument.match(/^--(base-url|compose-file|env-file)=(.+)$/);
    if (assigned) {
      if (assigned[1] === "base-url") options.baseUrl = assigned[2];
      if (assigned[1] === "compose-file") options.composeFile = assigned[2];
      if (assigned[1] === "env-file") options.envFile = assigned[2];
      continue;
    }
    if (["--base-url", "--compose-file", "--env-file"].includes(argument)) {
      const value = args[index + 1];
      if (!value) fail("invalid_arguments");
      index += 1;
      if (argument === "--base-url") options.baseUrl = value;
      if (argument === "--compose-file") options.composeFile = value;
      if (argument === "--env-file") options.envFile = value;
      continue;
    }
    fail("invalid_arguments");
  }
  if (!options.baseUrl) fail("invalid_arguments");
  options.composeFile ??= resolve(
    webDirectory,
    options.local ? "docker-compose.yml" : "docker-compose.production.yml",
  );
  if (!options.local) {
    options.envFile ??= resolve(webDirectory, ".env.production");
  }
  return options;
}

function composeArguments(options, command) {
  const args = ["compose", "--file", options.composeFile];
  if (options.envFile) {
    if (!existsSync(options.envFile)) fail("env_file_unavailable");
    args.push("--env-file", options.envFile);
  }
  args.push(...command);
  return args;
}

function dockerJson(options, command) {
  return JSON.parse(execFileSync("docker", composeArguments(options, command), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function containerId(options, service) {
  const id = execFileSync("docker", composeArguments(options, ["ps", "-q", service]), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!/^[0-9a-f]{12,64}$/.test(id)) fail("container_unavailable");
  return id;
}

function inspectContainer(id) {
  const values = JSON.parse(execFileSync("docker", ["inspect", id], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  if (!Array.isArray(values) || values.length !== 1) fail("container_unavailable");
  return values[0];
}

async function healthyContainer(options, service) {
  const deadline = Date.now() + 120_000;
  do {
    const inspection = inspectContainer(containerId(options, service));
    if (inspection.State?.Running === true && inspection.State?.Health?.Status === "healthy") {
      return inspection;
    }
    await delay(2_000);
  } while (Date.now() < deadline);
  fail("container_unhealthy");
}

function assertContainerPolicy(service, inspection) {
  const published = Object.values(inspection.NetworkSettings?.Ports ?? {})
    .flatMap(value => value ?? []);
  if ((service === "facilitator" || service === "redis") && published.length !== 0) {
    fail("internal_port_published");
  }
  const networks = Object.keys(inspection.NetworkSettings?.Networks ?? {}).sort();
  const backendNetworks = networks.filter(network =>
    network === "agentpay-backend" || network.endsWith("_backend")
  );
  if (backendNetworks.length !== 1) fail("network_policy_invalid");
  if (service === "web") {
    const ingressNetworks = networks.filter(network =>
      network === "web-net" || network.endsWith("_public")
    );
    if (networks.length !== 2 || ingressNetworks.length !== 1) {
      fail("network_policy_invalid");
    }
  } else if (service === "facilitator") {
    const egressNetworks = networks.filter(network =>
      network === "agentpay-egress" || network.endsWith("_egress")
    );
    if (networks.length !== 2 || egressNetworks.length !== 1) {
      fail("network_policy_invalid");
    }
  } else if (networks.length !== 1) {
    fail("network_policy_invalid");
  }
}

function internalSupported(options) {
  const source = [
    "fetch('http://facilitator:4022/supported')",
    ".then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())})",
    ".catch(()=>process.exit(1))",
  ].join("");
  const output = execFileSync("docker", composeArguments(options, [
    "exec",
    "-T",
    "web",
    "node",
    "-e",
    source,
  ]), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const supported = JSON.parse(output);
  if (JSON.stringify(supported.kinds) !== JSON.stringify([
    { x402Version: 2, scheme: "exact", network: BASE_NETWORK },
  ]) || !Array.isArray(supported.extensions) || supported.extensions.length !== 0) {
    fail("facilitator_policy_invalid");
  }
}

export async function verifyProduction(args) {
  const options = parseArguments(args);
  const rendered = dockerJson(options, ["config", "--format", "json"]);
  const webImage = options.local
    ? rendered.services?.web?.image
    : validateImageReference(rendered.services?.web?.image);
  const facilitatorImage = options.local
    ? rendered.services?.facilitator?.image
    : validateImageReference(rendered.services?.facilitator?.image);
  if (!webImage || !facilitatorImage) fail("image_mismatch");
  if (webImage !== facilitatorImage) fail("image_mismatch");

  const inspections = {};
  for (const service of ["web", "facilitator", "redis"]) {
    inspections[service] = await healthyContainer(options, service);
    assertContainerPolicy(service, inspections[service]);
  }
  if (inspections.web.Image !== inspections.facilitator.Image) fail("image_mismatch");
  internalSupported(options);

  const response = await fetch(`${canonicalBaseUrl(options.baseUrl)}/api/premium`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const contract = validateUnpaidContract({
    status: response.status,
    body: await response.json(),
    paymentRequired: response.headers.get("PAYMENT-REQUIRED"),
    baseUrl: options.baseUrl,
    payTo: rendered.services?.web?.environment?.AGENTPAY_PAY_TO,
  });
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    image: webImage,
    imageId: inspections.web.Image,
    contract,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyProduction(process.argv.slice(2)).catch(error => {
    const reason = error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? `: ${error.message}`
      : "";
    process.stderr.write(`AgentPay production verification failed${reason}\n`);
    process.exitCode = 1;
  });
}
