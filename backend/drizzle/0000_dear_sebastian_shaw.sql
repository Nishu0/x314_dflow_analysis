CREATE TYPE "public"."analysis_run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."attribution_source" AS ENUM('helius_enhanced', 'rpc_replay', 'first_party_execution');--> statement-breakpoint
CREATE TYPE "public"."signal_bias" AS ENUM('YES', 'NO', 'NEUTRAL');--> statement-breakpoint
CREATE TYPE "public"."confidence_band" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."hit_status" AS ENUM('ACTIVE', 'EXITED', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."hit_tier" AS ENUM('HITS_LOW', 'HITS_MEDIUM', 'HITS_HIGH');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('initialized', 'active', 'inactive', 'closed', 'determined');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."signal_mode" AS ENUM('MARKET_ONLY', 'WALLET_ENRICHED', 'FULL');--> statement-breakpoint
CREATE TABLE "analysis_market_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"market_ticker" text NOT NULL,
	"market_title" text NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"mode" "signal_mode" NOT NULL,
	"confidence_band" "confidence_band" NOT NULL,
	"bias" "signal_bias" NOT NULL,
	"edge_score" numeric(6, 3) NOT NULL,
	"conviction_score" numeric(6, 3) NOT NULL,
	"dislocation_score" numeric(6, 3) NOT NULL,
	"freshness_score" numeric(6, 3) NOT NULL,
	"liquidity_quality_score" numeric(6, 3) NOT NULL,
	"significant_flow_score" numeric(6, 3) NOT NULL,
	"significant_flow_usd_24h" numeric(20, 8),
	"evidence" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_market_snapshots_run_market_unique" UNIQUE("run_id","market_ticker")
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"pipeline_name" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" "analysis_run_status" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"worker_id" text,
	"input_window_start" timestamp with time zone,
	"input_window_end" timestamp with time zone,
	"markets_scanned" integer DEFAULT 0 NOT NULL,
	"markets_scored" integer DEFAULT 0 NOT NULL,
	"error" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"event_ticker" text PRIMARY KEY NOT NULL,
	"series_ticker" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"competition" text,
	"competition_scope" text,
	"image_url" text,
	"liquidity" numeric(20, 8),
	"open_interest" numeric(20, 8),
	"volume" numeric(20, 8),
	"volume_24h" numeric(20, 8),
	"strike_date" bigint,
	"strike_period" text,
	"status" "market_status",
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helius_webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_event_id" text,
	"signature" text,
	"slot" bigint,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "hits" (
	"hit_id" text PRIMARY KEY NOT NULL,
	"market_ticker" text NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone,
	"status" "hit_status" NOT NULL,
	"tier" "hit_tier" NOT NULL,
	"mode" "signal_mode" NOT NULL,
	"entry_metrics" jsonb NOT NULL,
	"current_metrics" jsonb NOT NULL,
	"invalidation_risk" numeric(6, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_cursors" (
	"source_key" text PRIMARY KEY NOT NULL,
	"cursor_value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_ticker" text NOT NULL,
	"quote_mint" text NOT NULL,
	"market_ledger" text NOT NULL,
	"yes_mint" text NOT NULL,
	"no_mint" text NOT NULL,
	"is_initialized" boolean NOT NULL,
	"redemption_status" text,
	"scalar_outcome_pct" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_accounts_unique_market_quote" UNIQUE("market_ticker","quote_mint")
);
--> statement-breakpoint
CREATE TABLE "market_signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_ticker" text NOT NULL,
	"signal_time" timestamp with time zone NOT NULL,
	"mode" "signal_mode" NOT NULL,
	"confidence_band" "confidence_band" NOT NULL,
	"bias" "signal_bias" NOT NULL,
	"significant_flow_score" numeric(6, 3) NOT NULL,
	"dislocation_score" numeric(6, 3) NOT NULL,
	"conviction_score" numeric(6, 3) NOT NULL,
	"freshness_score" numeric(6, 3) NOT NULL,
	"liquidity_quality_score" numeric(6, 3) NOT NULL,
	"edge_score" numeric(6, 3) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"market_ticker" text PRIMARY KEY NOT NULL,
	"event_ticker" text NOT NULL,
	"market_type" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"yes_sub_title" text NOT NULL,
	"no_sub_title" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"expiration_time" timestamp with time zone NOT NULL,
	"status" "market_status" NOT NULL,
	"result" text,
	"volume" numeric(20, 8) DEFAULT '0' NOT NULL,
	"open_interest" numeric(20, 8) DEFAULT '0' NOT NULL,
	"can_close_early" boolean DEFAULT false NOT NULL,
	"early_close_condition" text,
	"rules_primary" text NOT NULL,
	"rules_secondary" text,
	"yes_bid" numeric(8, 6),
	"yes_ask" numeric(8, 6),
	"no_bid" numeric(8, 6),
	"no_ask" numeric(8, 6),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orderbook_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_ticker" text NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"sequence" bigint,
	"yes_bids" jsonb NOT NULL,
	"no_bids" jsonb NOT NULL,
	"ingestion_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orderbook_snapshots_unique_market_time" UNIQUE("market_ticker","snapshot_time")
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"pipeline_name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_ticker" text NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"yes_bid" numeric(8, 6),
	"yes_ask" numeric(8, 6),
	"no_bid" numeric(8, 6),
	"no_ask" numeric(8, 6),
	"ingestion_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_snapshots_unique_market_time" UNIQUE("market_ticker","snapshot_time")
);
--> statement-breakpoint
CREATE TABLE "signal_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_signal_id" bigint NOT NULL,
	"evidence_key" text NOT NULL,
	"evidence_value" text NOT NULL,
	"evidence_weight" numeric(6, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_facts" (
	"trade_id" text PRIMARY KEY NOT NULL,
	"market_ticker" text NOT NULL,
	"created_time" timestamp with time zone NOT NULL,
	"taker_side" text NOT NULL,
	"price" integer NOT NULL,
	"count" integer NOT NULL,
	"yes_price" integer NOT NULL,
	"no_price" integer NOT NULL,
	"yes_price_dollars" numeric(8, 6),
	"no_price_dollars" numeric(8, 6),
	"notional_usd_est" numeric(20, 8),
	"ingestion_source" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_attributions" (
	"attribution_id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"market_ticker" text NOT NULL,
	"side" "side" NOT NULL,
	"size_contracts" numeric(20, 8),
	"size_usd_est" numeric(20, 8),
	"attributed_time" timestamp with time zone NOT NULL,
	"source" "attribution_source" NOT NULL,
	"attribution_confidence" numeric(6, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_outcomes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"market_ticker" text NOT NULL,
	"side" "side" NOT NULL,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"resolved" boolean DEFAULT false NOT NULL,
	"won" boolean,
	"realized_pnl_est" numeric(20, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_outcomes_unique_wallet_market_side" UNIQUE("wallet_address","market_ticker","side")
);
--> statement-breakpoint
CREATE TABLE "wallet_profiles" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"sample_size" integer NOT NULL,
	"hit_rate" numeric(6, 3),
	"timing_score" numeric(6, 3),
	"specialization_score" numeric(6, 3),
	"discipline_score" numeric(6, 3),
	"quality_score" numeric(6, 3),
	"category_raw" text,
	"category_normalized" text,
	"last_scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_market_snapshots" ADD CONSTRAINT "analysis_market_snapshots_run_id_analysis_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hits" ADD CONSTRAINT "hits_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_accounts" ADD CONSTRAINT "market_accounts_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_signals" ADD CONSTRAINT "market_signals_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_ticker_events_event_ticker_fk" FOREIGN KEY ("event_ticker") REFERENCES "public"."events"("event_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderbook_snapshots" ADD CONSTRAINT "orderbook_snapshots_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_market_signal_id_market_signals_id_fk" FOREIGN KEY ("market_signal_id") REFERENCES "public"."market_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_facts" ADD CONSTRAINT "trade_facts_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_attributions" ADD CONSTRAINT "wallet_attributions_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_outcomes" ADD CONSTRAINT "wallet_outcomes_wallet_address_wallet_profiles_wallet_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallet_profiles"("wallet_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_outcomes" ADD CONSTRAINT "wallet_outcomes_market_ticker_markets_market_ticker_fk" FOREIGN KEY ("market_ticker") REFERENCES "public"."markets"("market_ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_market_snapshots_run_edge_idx" ON "analysis_market_snapshots" USING btree ("run_id","edge_score");--> statement-breakpoint
CREATE INDEX "analysis_market_snapshots_market_time_idx" ON "analysis_market_snapshots" USING btree ("market_ticker","snapshot_time");--> statement-breakpoint
CREATE INDEX "analysis_runs_status_scheduled_idx" ON "analysis_runs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "analysis_runs_finished_idx" ON "analysis_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "helius_webhook_events_signature_idx" ON "helius_webhook_events" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "helius_webhook_events_processed_idx" ON "helius_webhook_events" USING btree ("processed","received_at");--> statement-breakpoint
CREATE INDEX "hits_market_status_idx" ON "hits" USING btree ("market_ticker","status");--> statement-breakpoint
CREATE INDEX "hits_entered_at_idx" ON "hits" USING btree ("entered_at");--> statement-breakpoint
CREATE INDEX "market_accounts_yes_mint_idx" ON "market_accounts" USING btree ("yes_mint");--> statement-breakpoint
CREATE INDEX "market_accounts_no_mint_idx" ON "market_accounts" USING btree ("no_mint");--> statement-breakpoint
CREATE UNIQUE INDEX "market_signals_unique_market_time_idx" ON "market_signals" USING btree ("market_ticker","signal_time");--> statement-breakpoint
CREATE INDEX "market_signals_market_time_idx" ON "market_signals" USING btree ("market_ticker","signal_time");--> statement-breakpoint
CREATE INDEX "market_signals_edge_idx" ON "market_signals" USING btree ("edge_score");--> statement-breakpoint
CREATE INDEX "markets_event_ticker_idx" ON "markets" USING btree ("event_ticker");--> statement-breakpoint
CREATE INDEX "markets_status_idx" ON "markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "markets_close_time_idx" ON "markets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "orderbook_snapshots_market_time_idx" ON "orderbook_snapshots" USING btree ("market_ticker","snapshot_time");--> statement-breakpoint
CREATE INDEX "price_snapshots_market_time_idx" ON "price_snapshots" USING btree ("market_ticker","snapshot_time");--> statement-breakpoint
CREATE INDEX "signal_evidence_signal_id_idx" ON "signal_evidence" USING btree ("market_signal_id");--> statement-breakpoint
CREATE INDEX "trade_facts_market_time_idx" ON "trade_facts" USING btree ("market_ticker","created_time");--> statement-breakpoint
CREATE INDEX "trade_facts_created_time_idx" ON "trade_facts" USING btree ("created_time");--> statement-breakpoint
CREATE INDEX "wallet_attributions_wallet_idx" ON "wallet_attributions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "wallet_attributions_market_time_idx" ON "wallet_attributions" USING btree ("market_ticker","attributed_time");