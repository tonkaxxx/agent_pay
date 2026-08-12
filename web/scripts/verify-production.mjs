import { decodePaymentRequiredHeader } from "@x402/core/http";
import { isDeepStrictEqual } from "node:util";

const EXPECTED = Object.freeze({
  x402Version: 2,
  scheme: "exact",
  network: "eip155:8453",
  amount: "10000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "--") arguments_.shift();
  const [originValue, recipient] = arguments_;
  invariant(originValue && recipient, "usage: verify-production <origin> <recipient>");

  let origin;
  try {
    origin = new URL(originValue);
  } catch {
    throw new Error("origin must be an absolute HTTP(S) URL");
  }
  invariant(
    origin.protocol === "http:" || origin.protocol === "https:",
    "origin must be an absolute HTTP(S) URL",
  );
  invariant(
    origin.pathname === "/" && origin.search === "" && origin.hash === "",
    "origin must not include a path, query, or fragment",
  );
  invariant(/^0x[0-9a-fA-F]{40}$/.test(recipient), "recipient must be an EVM address");

  return { origin, recipient };
}

async function checkedFetch(url) {
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`request failed for ${url.pathname}`);
  }
}

async function main() {
  const { origin, recipient } = parseArguments();
  const homepageUrl = new URL("/", origin);
  const premiumUrl = new URL("/api/premium", origin);

  const homepage = await checkedFetch(homepageUrl);
  invariant(homepage.status === 200, "homepage did not return 200");

  const premium = await checkedFetch(premiumUrl);
  invariant(premium.status === 402, "premium endpoint did not return 402");

  const encoded = premium.headers.get("payment-required");
  invariant(encoded, "PAYMENT-REQUIRED header is missing");

  let decoded;
  let body;
  try {
    decoded = decodePaymentRequiredHeader(encoded);
    body = await premium.json();
  } catch {
    throw new Error("payment challenge is not valid x402 JSON");
  }
  invariant(isDeepStrictEqual(body, {
    error: "Payment Required",
    priceUsdc: "0.01",
    payTo: recipient,
    network: "base",
    chainId: 8453,
  }), "402 body does not match the legacy AgentPay quote");
  invariant(decoded.x402Version === EXPECTED.x402Version, "unexpected x402 version");
  invariant(decoded.resource?.url === premiumUrl.href, "unexpected protected resource URL");
  invariant(decoded.extensions?.bazaar === undefined, "Bazaar discovery must be disabled");
  invariant(
    !JSON.stringify(decoded).includes("premiumData"),
    "payment challenge exposes premium output",
  );

  const accepted = decoded.accepts?.find(requirement =>
    requirement.scheme === EXPECTED.scheme
    && requirement.network === EXPECTED.network
    && requirement.amount === EXPECTED.amount
    && requirement.asset?.toLowerCase() === EXPECTED.asset.toLowerCase()
    && requirement.payTo?.toLowerCase() === recipient.toLowerCase()
  );
  invariant(accepted, "expected Base Mainnet USDC requirement is missing");

  const paymentIdentifier = decoded.extensions?.["payment-identifier"];
  invariant(
    paymentIdentifier?.info?.required === true,
    "Payment Identifier is not required",
  );

  process.stdout.write(`${JSON.stringify({
    homepage: homepage.status,
    premium: premium.status,
    legacyBody: true,
    x402Version: decoded.x402Version,
    scheme: accepted.scheme,
    network: accepted.network,
    amount: accepted.amount,
    paymentIdentifierRequired: true,
    bazaarPresent: false,
  })}\n`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "unknown verification error";
  process.stderr.write(`Production verification failed: ${message}\n`);
  process.exitCode = 1;
});
