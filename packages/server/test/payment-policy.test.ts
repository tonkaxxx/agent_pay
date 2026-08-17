import { expect, test } from "vitest";

import {
  BASE_NETWORK,
  BASE_USDC,
  InvalidPaymentPolicyError,
  createPaymentPolicy,
  type PaymentPolicy,
} from "../src/index.js";

const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const RESOURCE = "https://agentpay.example/g/public-abc";

const validInput = {
  resource: RESOURCE,
  payTo: PAY_TO,
  amountAtomic: "10000",
  maxTimeoutSeconds: 300,
  description: "Weather endpoint",
} as const;

test("builds a frozen validated payment policy with derived display values", () => {
  const policy = createPaymentPolicy(validInput);

  expect(Object.isFrozen(policy)).toBe(true);
  expect(policy).toEqual({
    scheme: "exact",
    network: BASE_NETWORK,
    asset: BASE_USDC,
    resource: RESOURCE,
    payTo: PAY_TO,
    amountAtomic: "10000",
    amountUsdc: "0.01",
    price: "$0.01",
    maxTimeoutSeconds: 300,
    description: "Weather endpoint",
  } satisfies PaymentPolicy);
});

test.each([
  ["1000000", "1", "$1"],
  ["1", "0.000001", "$0.000001"],
  ["1234567", "1.234567", "$1.234567"],
  ["1234500", "1.2345", "$1.2345"],
] as const)("derives the USDC display and price from %s", (amountAtomic, amountUsdc, price) => {
  const policy = createPaymentPolicy({ ...validInput, amountAtomic });
  expect(policy.amountUsdc).toBe(amountUsdc);
  expect(policy.price).toBe(price);
});

test("checksums a lowercase payout address", () => {
  const policy = createPaymentPolicy({
    ...validInput,
    payTo: PAY_TO.toLowerCase(),
  });
  expect(policy.payTo).toBe(PAY_TO);
});

test.each([
  ["payTo", { payTo: "not-an-address" }],
  ["payTo invalid hex", { payTo: "0xzzzz" }],
  ["resource fragment", { resource: `${RESOURCE}#fragment` }],
  ["resource not a url", { resource: "not-a-url" }],
  ["resource credentials", { resource: "https://user:pass@agentpay.example/g/public-abc" }],
  ["zero amount", { amountAtomic: "0" }],
  ["negated amount", { amountAtomic: "-5" }],
  ["non-integer amount", { amountAtomic: "10.5" }],
  ["empty amount", { amountAtomic: "" }],
  ["unbounded amount", { amountAtomic: "1000000001" }],
  ["timeout", { maxTimeoutSeconds: 0 }],
  ["negative timeout", { maxTimeoutSeconds: -1 }],
  ["missing description", { description: "" }],
] as const)("rejects an invalid policy (%s)", (_label, overrides) => {
  expect(() => createPaymentPolicy({ ...validInput, ...overrides })).toThrow(
    InvalidPaymentPolicyError,
  );
});

test("rejects a policy whose resource is not a canonical serialization", () => {
  expect(() => createPaymentPolicy({ ...validInput, resource: RESOURCE.toUpperCase() })).toThrow(
    InvalidPaymentPolicyError,
  );
});