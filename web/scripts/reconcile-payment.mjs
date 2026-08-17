#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import pg from "pg";

const PG_COLUMNS = [
  "endpoint_id",
  "request_id",
  "fingerprint",
  "payer_address",
  "tx_hash",
  "amount_atomic",
  "commission_atomic",
  "upstream_status",
  "upstream_duration_ms",
  "upstream_response_size",
  "settlement_duration_ms",
  "outcome",
];

function fail(reason) {
  throw new Error(reason);
}

export function commissionAtomic(amountAtomic) {
  const amount = BigInt(amountAtomic);
  return ((amount * 500n) / 10000n).toString();
}

export function parseReconcileArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const assigned = argument.match(/^--(request-id|endpoint-id|tx-hash)=(.+)$/);
    if (assigned) {
      if (assigned[1] === "request-id") options.requestId = assigned[2];
      if (assigned[1] === "endpoint-id") options.endpointId = assigned[2];
      if (assigned[1] === "tx-hash") options.txHash = assigned[2];
      continue;
    }
    fail("invalid_arguments");
  }
  if (!options.requestId || !options.endpointId || !options.txHash) fail("invalid_arguments");
  return options;
}

export async function reconcilePayment(input, dependencies) {
  const { query, verifyReceipt } = dependencies;
  if (!input.requestId || !input.endpointId || !input.txHash) fail("invalid_arguments");

  const endpointRows = await query(
    "SELECT id, pay_to, amount_atomic, status FROM merchant_endpoint WHERE id = $1 LIMIT 1",
    [input.endpointId],
  );
  if (endpointRows.length === 0) return { status: "endpoint_not_found" };
  const endpoint = endpointRows[0];

  const existing = await query(
    "SELECT id FROM payment_event WHERE tx_hash = $1 LIMIT 1",
    [input.txHash],
  );
  if (existing.length > 0) return { status: "already_recorded" };

  const receipt = await verifyReceipt({
    txHash: input.txHash,
    payTo: endpoint.pay_to,
    amountAtomic: endpoint.amount_atomic,
  });
  if (receipt.amountAtomic !== endpoint.amount_atomic) return { status: "amount_mismatch" };

  const values = [
    endpoint.id,
    input.requestId,
    null,
    receipt.payerAddress ?? null,
    input.txHash,
    endpoint.amount_atomic,
    commissionAtomic(endpoint.amount_atomic),
    null,
    null,
    null,
    null,
    "settled",
  ];
  await query(
    `INSERT INTO payment_event (${PG_COLUMNS.join(", ")})
     VALUES (${PG_COLUMNS.map((_, columnIndex) => `$${columnIndex + 1}`).join(", ")})`,
    values,
  );
  return { status: "recorded" };
}

export async function reconcileCli(args) {
  const options = parseReconcileArgs(args);
  const connectionString = process.env.DATABASE_URL || fail("database_url_required");
  const rpcUrl = process.env.AGENTPAY_RPC_URL || fail("rpc_url_required");

  const pool = new pg.Pool({ connectionString });
  let client;
  try {
    client = await pool.connect();
    const query = (text, params) => client.query(text, params).then((result) => result.rows);
    const verifyReceipt = (request) => verifyBaseReceipt(rpcUrl, request);
    return await reconcilePayment(options, { query, verifyReceipt });
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

export async function verifyBaseReceipt(rpcUrl, { txHash, payTo, amountAtomic }) {
  const receipt = await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt || receipt.status !== "0x1") fail("receipt_unconfirmed");
  const transfer = receipt.logs.find((log) =>
    log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
    log.topics[1]?.toLowerCase() === ("0x000000000000000000000000" + payTo.slice(2)).toLowerCase(),
  );
  if (!transfer) fail("transfer_not_found");
  const tokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
  if (transfer.address.toLowerCase() !== tokenAddress) fail("transfer_token_mismatch");
  const settled = BigInt(transfer.data);
  if (settled.toString() !== amountAtomic) fail("transfer_amount_mismatch");
  return { payerAddress: payTo, amountAtomic };
}

async function jsonRpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail("rpc_unavailable");
  const payload = await response.json();
  if (payload.error) fail("rpc_unavailable");
  return payload.result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcileCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    const reason = error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? `: ${error.message}`
      : "";
    process.stderr.write(`AgentPay payment reconciliation failed${reason}\n`);
    process.exitCode = 1;
  });
}