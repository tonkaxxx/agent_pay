import { isNotNull } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ],
);

export const authenticators = pgTable(
  "authenticator",
  {
    credentialID: text("credentialID").notNull().unique(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("providerAccountId").notNull(),
    credentialPublicKey: text("credentialPublicKey").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credentialDeviceType").notNull(),
    credentialBackedUp: boolean("credentialBackedUp").notNull(),
    transports: text("transports"),
  },
  (authenticator) => [
    primaryKey({
      columns: [authenticator.userId, authenticator.credentialID],
    }),
  ],
);

export const merchantEndpoints = pgTable(
  "merchant_endpoint",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    upstreamUrl: text("upstream_url").notNull(),
    authMode: text("auth_mode", {
      enum: ["none", "bearer", "x-api-key"],
    })
      .notNull()
      .default("none"),
    secretCiphertext: text("secret_ciphertext"),
    secretIv: text("secret_iv"),
    secretAuthTag: text("secret_auth_tag"),
    secretKeyVersion: integer("secret_key_version"),
    payTo: text("pay_to").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    payoutPolicy: text("payout_policy", {
      enum: ["threshold", "threshold_or_weekly"],
    })
      .notNull()
      .default("threshold_or_weekly"),
    status: text("status", {
      enum: ["draft", "active", "paused"],
    })
      .notNull()
      .default("draft"),
    configVersion: integer("config_version").notNull().default(1),
    lastTestStatus: text("last_test_status"),
    lastTestHttpStatus: integer("last_test_http_status"),
    lastTestResponseSize: integer("last_test_response_size"),
    lastTestLatencyMs: integer("last_test_latency_ms"),
    lastTestAt: timestamp("last_test_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("merchant_endpoint_owner_idx").on(table.ownerId),
    index("merchant_endpoint_status_idx").on(table.status),
  ],
);

export const financeState = pgTable("finance_state", {
  id: integer("id").primaryKey().default(1),
  paused: boolean("paused").notNull().default(false),
  pauseReason: text("pause_reason"),
  reservedSellerNetAtomic: text("reserved_seller_net_atomic").notNull().default("0"),
  workerHeartbeatAt: timestamp("worker_heartbeat_at", { mode: "date" }),
  reconciledAt: timestamp("reconciled_at", { mode: "date" }),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const feeSweeps = pgTable("fee_sweep", {
  id: uuid("id").defaultRandom().primaryKey(),
  amountAtomic: text("amount_atomic").notNull(),
  status: text("status", {
    enum: ["prepared", "submitted", "confirmed", "failed"],
  }).notNull().default("prepared"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "date" }),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const payoutBatches = pgTable(
  "payout_batch",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerPayTo: text("seller_pay_to").notNull(),
    sellerNetAtomic: text("seller_net_atomic").notNull(),
    commissionAtomic: text("commission_atomic").notNull(),
    status: text("status", {
      enum: ["prepared", "submitted", "confirmed", "failed"],
    }).notNull().default("prepared"),
    feeSweepId: uuid("fee_sweep_id").references(() => feeSweeps.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("payout_batch_status_idx").on(table.status),
    index("payout_batch_fee_sweep_idx").on(table.feeSweepId),
  ],
);

export const settlementObligations = pgTable(
  "settlement_obligation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => merchantEndpoints.id, { onDelete: "restrict" }),
    payoutBatchId: uuid("payout_batch_id").references(() => payoutBatches.id, {
      onDelete: "restrict",
    }),
    requestId: text("request_id").notNull(),
    fingerprint: text("fingerprint").notNull().unique(),
    payerAddress: text("payer_address").notNull(),
    authorizationNonce: text("authorization_nonce").notNull(),
    authorizationValidBefore: timestamp("authorization_valid_before", { mode: "date" }).notNull(),
    sellerPayTo: text("seller_pay_to").notNull(),
    grossAtomic: text("gross_atomic").notNull(),
    commissionAtomic: text("commission_atomic").notNull(),
    sellerNetAtomic: text("seller_net_atomic").notNull(),
    settlementStatus: text("settlement_status", {
      enum: ["pending", "settled", "failed", "cancelled"],
    }).notNull().default("pending"),
    settlementTxHash: text("settlement_tx_hash"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("settlement_obligation_tx_hash_uq")
      .on(table.settlementTxHash)
      .where(isNotNull(table.settlementTxHash)),
    index("settlement_obligation_endpoint_idx").on(table.endpointId),
    index("settlement_obligation_status_idx").on(table.settlementStatus),
    index("settlement_obligation_payout_batch_idx").on(table.payoutBatchId),
  ],
);

export const outgoingTransferAttempts = pgTable(
  "outgoing_transfer_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessKey: text("business_key").notNull(),
    transferKind: text("transfer_kind", { enum: ["seller", "fee"] }).notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    nonce: text("nonce").notNull(),
    recipient: text("recipient").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    rawTransaction: text("raw_transaction").notNull(),
    txHash: text("tx_hash").notNull().unique(),
    status: text("status", {
      enum: ["signed", "submitted", "confirmed", "reverted", "replaced"],
    }).notNull().default("signed"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { mode: "date" }),
    confirmedAt: timestamp("confirmed_at", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("outgoing_transfer_business_attempt_uq")
      .on(table.businessKey, table.attemptNumber),
    index("outgoing_transfer_status_idx").on(table.status),
  ],
);

export const paymentEvents = pgTable(
  "payment_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => merchantEndpoints.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    fingerprint: text("fingerprint"),
    payerAddress: text("payer_address"),
    txHash: text("tx_hash"),
    amountAtomic: text("amount_atomic").notNull(),
    commissionAtomic: text("commission_atomic").notNull(),
    upstreamStatus: integer("upstream_status"),
    upstreamDurationMs: integer("upstream_duration_ms"),
    upstreamResponseSize: integer("upstream_response_size"),
    settlementDurationMs: integer("settlement_duration_ms"),
    outcome: text("outcome").notNull(),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_event_fingerprint_uq")
      .on(table.fingerprint)
      .where(isNotNull(table.fingerprint)),
    uniqueIndex("payment_event_tx_hash_uq")
      .on(table.txHash)
      .where(isNotNull(table.txHash)),
    index("payment_event_endpoint_idx").on(table.endpointId),
  ],
);

export const auditEvents = pgTable(
  "audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id").references(
      () => merchantEndpoints.id,
      { onDelete: "cascade" },
    ),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_event_endpoint_idx").on(table.endpointId),
    index("audit_event_created_idx").on(table.createdAt),
  ],
);
