CREATE TABLE "account" (
	"userId" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authenticator" (
	"credentialID" text NOT NULL,
	"userId" uuid NOT NULL,
	"providerAccountId" text NOT NULL,
	"credentialPublicKey" text NOT NULL,
	"counter" integer NOT NULL,
	"credentialDeviceType" text NOT NULL,
	"credentialBackedUp" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "authenticator_userId_credentialID_pk" PRIMARY KEY("userId","credentialID"),
	CONSTRAINT "authenticator_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE TABLE "merchant_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"upstream_url" text NOT NULL,
	"auth_mode" text DEFAULT 'none' NOT NULL,
	"secret_ciphertext" text,
	"secret_iv" text,
	"secret_auth_tag" text,
	"secret_key_version" integer,
	"pay_to" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"last_test_status" text,
	"last_test_http_status" integer,
	"last_test_response_size" integer,
	"last_test_latency_ms" integer,
	"last_test_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_endpoint_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"fingerprint" text,
	"payer_address" text,
	"tx_hash" text,
	"amount_atomic" text NOT NULL,
	"commission_atomic" text NOT NULL,
	"upstream_status" integer,
	"upstream_duration_ms" integer,
	"upstream_response_size" integer,
	"settlement_duration_ms" integer,
	"outcome" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_endpoint_id_merchant_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."merchant_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authenticator" ADD CONSTRAINT "authenticator_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_endpoint" ADD CONSTRAINT "merchant_endpoint_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_endpoint_id_merchant_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."merchant_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_endpoint_idx" ON "audit_event" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "merchant_endpoint_owner_idx" ON "merchant_endpoint" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "merchant_endpoint_status_idx" ON "merchant_endpoint" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_fingerprint_uq" ON "payment_event" USING btree ("fingerprint") WHERE "payment_event"."fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_tx_hash_uq" ON "payment_event" USING btree ("tx_hash") WHERE "payment_event"."tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "payment_event_endpoint_idx" ON "payment_event" USING btree ("endpoint_id");