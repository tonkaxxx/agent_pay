ALTER TABLE "merchant_endpoint" ADD COLUMN "payout_policy" text DEFAULT 'threshold_or_weekly' NOT NULL;--> statement-breakpoint
CREATE TABLE "finance_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"pause_reason" text,
	"reserved_seller_net_atomic" text DEFAULT '0' NOT NULL,
	"worker_heartbeat_at" timestamp,
	"reconciled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_state_singleton" CHECK ("id" = 1)
);--> statement-breakpoint
INSERT INTO "finance_state" ("id") VALUES (1);--> statement-breakpoint
CREATE TABLE "fee_sweep" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount_atomic" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "payout_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_pay_to" text NOT NULL,
	"seller_net_atomic" text NOT NULL,
	"commission_atomic" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"fee_sweep_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "settlement_obligation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"payout_batch_id" uuid,
	"request_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payer_address" text NOT NULL,
	"authorization_nonce" text NOT NULL,
	"authorization_valid_before" timestamp NOT NULL,
	"seller_pay_to" text NOT NULL,
	"gross_atomic" text NOT NULL,
	"commission_atomic" text NOT NULL,
	"seller_net_atomic" text NOT NULL,
	"settlement_status" text DEFAULT 'pending' NOT NULL,
	"settlement_tx_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_obligation_fingerprint_unique" UNIQUE("fingerprint")
);--> statement-breakpoint
CREATE TABLE "outgoing_transfer_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_key" text NOT NULL,
	"transfer_kind" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"nonce" text NOT NULL,
	"recipient" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"raw_transaction" text NOT NULL,
	"tx_hash" text NOT NULL,
	"status" text DEFAULT 'signed' NOT NULL,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"confirmed_at" timestamp,
	CONSTRAINT "outgoing_transfer_attempt_tx_hash_unique" UNIQUE("tx_hash")
);--> statement-breakpoint
ALTER TABLE "payout_batch" ADD CONSTRAINT "payout_batch_fee_sweep_id_fee_sweep_id_fk" FOREIGN KEY ("fee_sweep_id") REFERENCES "public"."fee_sweep"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_obligation" ADD CONSTRAINT "settlement_obligation_endpoint_id_merchant_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."merchant_endpoint"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_obligation" ADD CONSTRAINT "settlement_obligation_payout_batch_id_payout_batch_id_fk" FOREIGN KEY ("payout_batch_id") REFERENCES "public"."payout_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_batch_status_idx" ON "payout_batch" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payout_batch_fee_sweep_idx" ON "payout_batch" USING btree ("fee_sweep_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_obligation_tx_hash_uq" ON "settlement_obligation" USING btree ("settlement_tx_hash") WHERE "settlement_obligation"."settlement_tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "settlement_obligation_endpoint_idx" ON "settlement_obligation" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "settlement_obligation_status_idx" ON "settlement_obligation" USING btree ("settlement_status");--> statement-breakpoint
CREATE INDEX "settlement_obligation_payout_batch_idx" ON "settlement_obligation" USING btree ("payout_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outgoing_transfer_business_attempt_uq" ON "outgoing_transfer_attempt" USING btree ("business_key","attempt_number");--> statement-breakpoint
CREATE INDEX "outgoing_transfer_status_idx" ON "outgoing_transfer_attempt" USING btree ("status");
