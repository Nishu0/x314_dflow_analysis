# x314 dFlow Wallet-First Intelligence Technical Specification

- Version: 2.0
- Status: Active implementation
- Date: 2026-03-03
- Primary repo: `x314_dflow_analysis`

## 1) Objective

Build a wallet-first market intelligence system for dFlow that:

1. Detects large orders from trade flow.
2. Strictly attributes those orders to wallets.
3. Tags wallets as insider/whale using deterministic rules.
4. Returns market opportunities through two endpoints only:
   - `GET /markets`
   - `GET /markets/:marketTicker/details`

## 2) Product Scope

In scope:

- dFlow trade ingestion and USD normalization.
- Strict wallet attribution from confirmed sources.
- Wallet profiling (activity count, first-seen age proxy, balance).
- Wallet tagging (`INSIDER`, `WHALE`, `NONE`).
- Market list and market details with holders.

Out of scope:

- Any public `/signals/*` API surface.
- Any attribution-by-inference without confirmed mapping.
- Auto-trading or execution.

## 3) Source-Backed Constraints

Confirmed:

- dFlow trade payload does not include wallet address directly.
- Wallet attribution must come from external/on-chain sources.
- Queue-first architecture runs analysis every minute and updates run-health counters.

Strict attribution policy:

- Only these sources qualify for wallet tags:
  - `helius_enhanced`
  - `rpc_replay`
- Orders without strict attribution are never labeled insider/whale.

## 4) Canonical Runtime Flow

Per minute:

1. Ingest latest dFlow trade window.
2. Convert trades to USD notional (`notionalUsdEst`).
3. Filter large orders (`LARGE_ORDER_MIN_USD`, default `1000`).
4. Resolve wallet attributions for those orders.
5. Build wallet profile primitives:
   - order counts
   - first seen timestamp (account age proxy)
   - wallet balance in USD
6. Classify wallet:
   - `INSIDER`: newer wallet + large confirmed orders
   - `WHALE`: older wallet + high balance + large confirmed orders
7. Build wallet-first market list directly from tagged wallets and their related markets.

## 5) Wallet Tag Rules

Environment defaults:

- `LARGE_ORDER_MIN_USD=1000`
- `TAG_MIN_ORDER_USD=3000`
- `WHALE_MIN_BALANCE_USD=30000`
- `INSIDER_MAX_ACCOUNT_AGE_DAYS=30`

Classification:

- `INSIDER` when:
  - wallet age days `<= INSIDER_MAX_ACCOUNT_AGE_DAYS`
  - confirmed large-order total `>= TAG_MIN_ORDER_USD`
- `WHALE` when:
  - wallet age days `> INSIDER_MAX_ACCOUNT_AGE_DAYS`
  - wallet balance USD `>= WHALE_MIN_BALANCE_USD`
  - confirmed large-order total `>= TAG_MIN_ORDER_USD`
- Otherwise: `NONE`

## 6) API Contract (Current)

### 6.1 `GET /markets`

Purpose:

- Return current markets with active insider/whale signal from tagged wallets in the active analysis window.

Returns:

- `generatedAt`, `count`
- `markets[]` with:
  - market identifiers and pricing context
  - top wallet signal (`type`, `confidencePercent`, `reason`, `walletAddress`)

Filter behavior:

- Only `INSIDER` and `WHALE` markets are included.

### 6.2 `GET /markets/:marketTicker/details`

Purpose:

- Return a single market plus strictly-tagged holders for the analysis window.

Returns:

- `market` object with core market fields and latest wallet signal
- `holders[]` where each holder is only `INSIDER` or `WHALE`:
  - `walletAddress`
  - `tag`
  - `largeOrdersCount`
  - `largeOrdersUsdTotal`
  - `walletBalanceUsd`
  - `walletFirstSeenAt`
  - `walletAgeDays`
  - `lastOrderAt`
  - `attributionSource`
  - `attributionConfidence`
  - `relatedMarketTickers`
- `summary`:
  - `holderCountsByTag`
  - `totalLargeOrderUsd`
  - `analysisWindowHours`

## 7) Data Model Focus

Core tables for this product mode:

- `trade_facts`
- `wallet_attributions`
- `markets`
- `analysis_runs`

Optional/supporting:

- `wallet_profiles`
- `helius_webhook_events`

## 8) Endpoint Surface Policy

Public routes kept:

- `GET /health`
- `GET /markets`
- `GET /markets/:marketTicker/details`

Internal routes kept:

- `POST /internal/rpc-attribution`
- `GET /internal/rpc-replay/:signature`
- `GET /internal/diagnostics`

Public routes removed from active spec:

- all `/signals/*`
- public wallet profile route

## 9) External Integration Notes

Helius:

- Enhanced Transactions endpoint is used for strict attribution pipeline.
- Webhooks are supported for near-real-time ingestion; retries can duplicate events and must be de-duplicated.

Pyth:

- Hermes endpoint provides SOL/USD feed used to convert wallet SOL balance to USD.

## 10) Acceptance Criteria

1. `/markets` returns only insider/whale-led markets.
2. `/markets/:marketTicker/details` returns market data + tagged holders only.
3. No wallet tag appears without strict attribution source.
4. Queue run continues at 1-minute cadence with wallet-first processing.
5. Typecheck and tests pass in CI.
