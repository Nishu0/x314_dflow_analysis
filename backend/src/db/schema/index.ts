import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";
import type { JsonValue } from "../../types/json";

const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const marketStatusEnum = pgEnum("market_status", [
  "initialized",
  "active",
  "inactive",
  "closed",
  "determined"
]);

export const attributionSourceEnum = pgEnum("attribution_source", [
  "helius_enhanced",
  "rpc_replay",
  "first_party_execution"
]);

export const sideEnum = pgEnum("side", ["YES", "NO"]);

export const analysisRunStatusEnum = pgEnum("analysis_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED"
]);

export const events = pgTable("events", {
  eventTicker: text("event_ticker").primaryKey(),
  seriesTicker: text("series_ticker").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  competition: text("competition"),
  competitionScope: text("competition_scope"),
  imageUrl: text("image_url"),
  liquidity: numeric("liquidity", { precision: 20, scale: 8 }),
  openInterest: numeric("open_interest", { precision: 20, scale: 8 }),
  volume: numeric("volume", { precision: 20, scale: 8 }),
  volume24h: numeric("volume_24h", { precision: 20, scale: 8 }),
  strikeDate: bigint("strike_date", { mode: "number" }),
  strikePeriod: text("strike_period"),
  status: marketStatusEnum("status"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestampColumns
});

export const markets = pgTable(
  "markets",
  {
    marketTicker: text("market_ticker").primaryKey(),
    eventTicker: text("event_ticker")
      .notNull()
      .references(() => events.eventTicker),
    marketType: text("market_type").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull(),
    yesSubTitle: text("yes_sub_title").notNull(),
    noSubTitle: text("no_sub_title").notNull(),
    openTime: timestamp("open_time", { withTimezone: true }).notNull(),
    closeTime: timestamp("close_time", { withTimezone: true }).notNull(),
    expirationTime: timestamp("expiration_time", { withTimezone: true }).notNull(),
    status: marketStatusEnum("status").notNull(),
    result: text("result"),
    volume: numeric("volume", { precision: 20, scale: 8 }).notNull().default("0"),
    openInterest: numeric("open_interest", { precision: 20, scale: 8 }).notNull().default("0"),
    canCloseEarly: boolean("can_close_early").notNull().default(false),
    earlyCloseCondition: text("early_close_condition"),
    rulesPrimary: text("rules_primary").notNull(),
    rulesSecondary: text("rules_secondary"),
    yesBid: numeric("yes_bid", { precision: 8, scale: 6 }),
    yesAsk: numeric("yes_ask", { precision: 8, scale: 6 }),
    noBid: numeric("no_bid", { precision: 8, scale: 6 }),
    noAsk: numeric("no_ask", { precision: 8, scale: 6 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestampColumns
  },
  (t) => [
    index("markets_event_ticker_idx").on(t.eventTicker),
    index("markets_status_idx").on(t.status),
    index("markets_close_time_idx").on(t.closeTime)
  ]
);

export const marketAccounts = pgTable(
  "market_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketTicker: text("market_ticker")
      .notNull()
      .references(() => markets.marketTicker),
    quoteMint: text("quote_mint").notNull(),
    marketLedger: text("market_ledger").notNull(),
    yesMint: text("yes_mint").notNull(),
    noMint: text("no_mint").notNull(),
    isInitialized: boolean("is_initialized").notNull(),
    redemptionStatus: text("redemption_status"),
    scalarOutcomePct: integer("scalar_outcome_pct"),
    ...timestampColumns
  },
  (t) => [
    unique("market_accounts_unique_market_quote").on(t.marketTicker, t.quoteMint),
    index("market_accounts_yes_mint_idx").on(t.yesMint),
    index("market_accounts_no_mint_idx").on(t.noMint)
  ]
);

export const tradeFacts = pgTable(
  "trade_facts",
  {
    tradeId: text("trade_id").primaryKey(),
    marketTicker: text("market_ticker")
      .notNull()
      .references(() => markets.marketTicker),
    createdTime: timestamp("created_time", { withTimezone: true }).notNull(),
    takerSide: text("taker_side").notNull(),
    price: integer("price").notNull(),
    count: integer("count").notNull(),
    yesPrice: integer("yes_price").notNull(),
    noPrice: integer("no_price").notNull(),
    yesPriceDollars: numeric("yes_price_dollars", { precision: 8, scale: 6 }),
    noPriceDollars: numeric("no_price_dollars", { precision: 8, scale: 6 }),
    notionalUsdEst: numeric("notional_usd_est", { precision: 20, scale: 8 }),
    ingestionSource: text("ingestion_source").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("trade_facts_market_time_idx").on(t.marketTicker, t.createdTime),
    index("trade_facts_created_time_idx").on(t.createdTime)
  ]
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketTicker: text("market_ticker")
      .notNull()
      .references(() => markets.marketTicker),
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    yesBid: numeric("yes_bid", { precision: 8, scale: 6 }),
    yesAsk: numeric("yes_ask", { precision: 8, scale: 6 }),
    noBid: numeric("no_bid", { precision: 8, scale: 6 }),
    noAsk: numeric("no_ask", { precision: 8, scale: 6 }),
    ingestionSource: text("ingestion_source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("price_snapshots_unique_market_time").on(t.marketTicker, t.snapshotTime),
    index("price_snapshots_market_time_idx").on(t.marketTicker, t.snapshotTime)
  ]
);

export const orderbookSnapshots = pgTable(
  "orderbook_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marketTicker: text("market_ticker")
      .notNull()
      .references(() => markets.marketTicker),
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    sequence: bigint("sequence", { mode: "number" }),
    yesBids: jsonb("yes_bids").$type<Record<string, number>>().notNull(),
    noBids: jsonb("no_bids").$type<Record<string, number>>().notNull(),
    ingestionSource: text("ingestion_source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("orderbook_snapshots_unique_market_time").on(t.marketTicker, t.snapshotTime),
    index("orderbook_snapshots_market_time_idx").on(t.marketTicker, t.snapshotTime)
  ]
);


export const walletProfiles = pgTable("wallet_profiles", {
  walletAddress: text("wallet_address").primaryKey(),
  sampleSize: integer("sample_size").notNull(),
  hitRate: numeric("hit_rate", { precision: 6, scale: 3 }),
  timingScore: numeric("timing_score", { precision: 6, scale: 3 }),
  specializationScore: numeric("specialization_score", { precision: 6, scale: 3 }),
  disciplineScore: numeric("discipline_score", { precision: 6, scale: 3 }),
  qualityScore: numeric("quality_score", { precision: 6, scale: 3 }),
  categoryRaw: text("category_raw"),
  categoryNormalized: text("category_normalized"),
  lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
  ...timestampColumns
});

export const walletAttributions = pgTable(
  "wallet_attributions",
  {
    attributionId: text("attribution_id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    marketTicker: text("market_ticker")
      .notNull()
      .references(() => markets.marketTicker),
    side: sideEnum("side").notNull(),
    sizeContracts: numeric("size_contracts", { precision: 20, scale: 8 }),
    sizeUsdEst: numeric("size_usd_est", { precision: 20, scale: 8 }),
    attributedTime: timestamp("attributed_time", { withTimezone: true }).notNull(),
    source: attributionSourceEnum("source").notNull(),
    attributionConfidence: numeric("attribution_confidence", { precision: 6, scale: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("wallet_attributions_wallet_idx").on(t.walletAddress),
    index("wallet_attributions_market_time_idx").on(t.marketTicker, t.attributedTime)
  ]
);

export const walletOutcomes = pgTable(
  "wallet_outcomes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    walletAddress: text("wallet_address")
      .notNull()
      .references(() => walletProfiles.walletAddress),
    marketTicker: text("market_ticker")
      .notNull()
      .references(() => markets.marketTicker),
    side: sideEnum("side").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    resolved: boolean("resolved").notNull().default(false),
    won: boolean("won"),
    realizedPnlEst: numeric("realized_pnl_est", { precision: 20, scale: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [unique("wallet_outcomes_unique_wallet_market_side").on(t.walletAddress, t.marketTicker, t.side)]
);

export const heliusWebhookEvents = pgTable(
  "helius_webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    webhookEventId: text("webhook_event_id"),
    signature: text("signature"),
    slot: bigint("slot", { mode: "number" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error")
  },
  (t) => [
    index("helius_webhook_events_signature_idx").on(t.signature),
    index("helius_webhook_events_processed_idx").on(t.processed, t.receivedAt)
  ]
);

export const ingestCursors = pgTable("ingest_cursors", {
  sourceKey: text("source_key").primaryKey(),
  cursorValue: text("cursor_value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const pipelineRuns = pgTable("pipeline_runs", {
  runId: text("run_id").primaryKey(),
  pipelineName: text("pipeline_name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  details: jsonb("details").$type<JsonValue>()
});

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    runId: text("run_id").primaryKey(),
    pipelineName: text("pipeline_name").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: analysisRunStatusEnum("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    workerId: text("worker_id"),
    inputWindowStart: timestamp("input_window_start", { withTimezone: true }),
    inputWindowEnd: timestamp("input_window_end", { withTimezone: true }),
    marketsScanned: integer("markets_scanned").notNull().default(0),
    marketsScored: integer("markets_scored").notNull().default(0),
    error: text("error"),
    details: jsonb("details").$type<JsonValue>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("analysis_runs_idempotency_key_unique").on(t.idempotencyKey),
    index("analysis_runs_status_scheduled_idx").on(t.status, t.scheduledFor),
    index("analysis_runs_finished_idx").on(t.finishedAt)
  ]
);
