# x314 dFlow Analysis

x314 dFlow Analysis is a Bun and Elysia backend for signal driven analytics on dFlow prediction markets.

The purpose is to detect information quality differences in markets instead of following public narratives. Users connect with their own dFlow API key and query ranked market signals, conviction snapshots, and wallet intelligence outputs.

## Product Direction

Most traders react to headlines and social sentiment. x314 focuses on behavior and structure.

1. Identify who enters early versus late.
2. Score which wallet cohorts convert signal into resolution accuracy.
3. Detect where market price and informed flow diverge.
4. Track conviction changes across time windows.

## x314 Naming Convention

x314 uses its own product language.

1. Pulse Board: Ranked markets with unusual flow and dislocation.
2. Conviction Map: Confidence scoring for each side of a market.
3. Signal Drift: Flow and sentiment movement across time windows.
4. Edge Window: Active opportunities where price and informed flow diverge.
5. Shadow Watch: Insider style behavior detection.
6. Retail Pressure: Low quality flow concentration view.
7. Catalyst Feed: Whale and fast follow activity events.
8. Resolution Memory: Historical accuracy ledger for wallets and markets.

## What We Are Building

### 1. Ingestion Layer

1. Pull dFlow market data with API key authentication.
2. Normalize market metadata and pricing fields.
3. Build snapshots for time series analysis.

### 2. Wallet Intelligence Layer

1. Track wallet behavior across active and resolved markets.
2. Compute wallet quality metrics such as hit rate, entry timing efficiency, withdrawal behavior, category specialization, and size discipline.

### 3. Signal Engine

1. Calculate market side conviction scores.
2. Detect dislocation between implied probability and informed flow.
3. Surface higher confidence setups when independent signals align.

### 4. Decision Layer

1. Return machine readable responses for frontend and CLI integration.
2. Include compact evidence fields that explain signal generation.
3. Keep scoring inputs deterministic for auditability.

## Current Backend API

Base URL on local machine: `http://localhost:3000`

1. `GET /health` for service health check.
2. `GET /markets/raw?limit=50` for raw normalized market output.
3. `GET /markets/convictions?limit=100` for ranked conviction output.
4. `GET /signals/pulse-board` for ranked signal board from latest successful run.
5. `GET /signals/hits` for HITS lifecycle output.
6. `GET /signals/conviction-map`, `/signals/drift`, `/signals/edge-window`, `/signals/catalyst-feed`.
7. `GET /wallets/:walletAddress/profile` for wallet profile data when available.
8. `POST /internal/rpc-attribution` for RPC-based wallet attribution ingestion.
9. `GET /internal/diagnostics` and `GET /internal/rpc-replay/:signature` require `x-internal-token` when `INTERNAL_API_TOKEN` is set.

## Data and Security

1. Users must provide `DFLOW_API_KEY`.
2. Backend sends this key as `x-api-key` to dFlow APIs.
3. API keys are loaded from environment variables only.
4. API keys must never be committed to git.
5. Multi user secure key storage will be added in future versions.

## Local Setup

1. Start Postgres and Redis.

```bash
docker compose up -d
```

2. Go to backend directory.

```bash
cd backend
```

3. Install dependencies.

```bash
bun install
```

4. Create environment file.

```bash
cp .env.example .env
```

5. Set dFlow key in `.env`.

```env
DFLOW_API_KEY=your_real_key
```

6. Generate and apply DB migrations.

```bash
bun run db:generate
bun run db:migrate
```

7. Start dev server.

```bash
bun run dev
```

The backend starts a BullMQ worker that enqueues and executes `analysis_tick` every minute.

Core runtime flow is ordered as:

1. orderbook analysis
2. wallet processor
3. market analysis

API score endpoints serve the latest successful persisted snapshot by default and support `runId` for historical replay reads.

Logging:

- Server and runtime logs are emitted to stdout using `pino`.
- No file logger is used.

## Scripts

From `backend/`:

```bash
bun run check
bun run test
bun run replay:backtest -- <runId>
bun run replay:compare -- <runIdA> <runIdB>
```

## Backend Structure

```text
backend/
  src/
    config.ts
    index.ts
    lib/
      dflow-client.ts
    routes/
      health.ts
      markets.ts
      signals.ts
      wallets.ts
    services/
      analysis-pipeline.ts
```

## Product Principles

1. Evidence over narrative.
2. Repeatable process over opinion.
3. Multi signal confirmation over one indicator decisions.
4. Explainable scoring over black box output.

## License and Access

Copyright (c) x314.

All rights reserved.

You are not allowed to use, copy, modify, publish, distribute, sublicense, or deploy x314 dFlow Analysis without explicit written permission from the x314 team.

To use x314, you must first take permission from x314.

For permission requests, contact the x314 team before any use.

## Disclaimer

x314 provides analytics and research support only. This software is not financial advice. Users are responsible for their own risk decisions.
