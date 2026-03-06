# x314 Drizzle Contracts and API Types (Wallet-First)

- Version: 2.0
- Date: 2026-03-03
- Companion spec: `docs/x314-dflow-market-intelligence-tech-spec.md`

## 1) Purpose

Define the active contracts for the wallet-first product mode:

- DB entities used by the current flow
- Public API response contracts
- strict attribution constraints

## 2) Active Public API Contracts

## 2.1 `GET /markets`

```json
{
  "generatedAt": "2026-03-03T12:00:00.000Z",
  "count": 2,
  "markets": [
    {
      "marketTicker": "BTC-29MAR26-T120K",
      "eventTicker": "BTC-29MAR26",
      "title": "Will BTC settle above 120k?",
      "subtitle": "Mar 29 close",
      "status": "active",
      "yesBid": 0.48,
      "yesAsk": 0.5,
      "noBid": 0.5,
      "noAsk": 0.52,
      "walletSignal": {
        "type": "WHALE",
        "confidencePercent": 77,
        "reason": "High-balance wallet traded $9800 in this market",
        "walletAddress": "..."
      }
    }
  ]
}
```

Rules:

- Output includes only markets currently tagged `INSIDER` or `WHALE`.

## 2.2 `GET /markets/:marketTicker/details`

```json
{
  "generatedAt": "2026-03-03T12:00:00.000Z",
  "market": {
    "marketTicker": "BTC-29MAR26-T120K",
    "eventTicker": "BTC-29MAR26",
    "title": "Will BTC settle above 120k?",
    "subtitle": "Mar 29 close",
    "status": "active",
    "volume": 234000,
    "openInterest": 120000,
    "yesBid": 0.48,
    "yesAsk": 0.5,
    "noBid": 0.5,
    "noAsk": 0.52,
    "walletSignal": {
      "type": "INSIDER",
      "confidencePercent": 74,
      "reason": "New wallet (~8d old) placed large orders",
      "walletAddress": "..."
    }
  },
  "holders": [
    {
      "walletAddress": "...",
      "tag": "INSIDER",
      "largeOrdersCount": 3,
      "largeOrdersUsdTotal": 4700,
      "walletBalanceUsd": 2400,
      "walletFirstSeenAt": "2026-02-24T10:00:00.000Z",
      "walletAgeDays": 8,
      "lastOrderAt": "2026-03-03T11:59:00.000Z",
      "attributionSource": "rpc_replay",
      "attributionConfidence": 0.74,
      "relatedMarketTickers": ["BTC-29MAR26-T120K", "ETH-29MAR26-T6K"]
    }
  ],
  "summary": {
    "holderCountsByTag": {
      "insider": 1,
      "whale": 0
    },
    "totalLargeOrderUsd": 4700,
    "analysisWindowHours": 24
  }
}
```

Rules:

- `holders[]` includes only `INSIDER` and `WHALE`.
- `NONE` and unattributed wallets are excluded.

## 3) Active Table Set

Required:

- `markets`
- `trade_facts`
- `wallet_attributions`
- `analysis_runs`

Optional/supporting:

- `wallet_profiles`
- `helius_webhook_events`

## 4) Strict Attribution and Threshold Rules

Allowed attribution sources for tagging:

- `helius_enhanced`
- `rpc_replay`

Current default thresholds:

- `LARGE_ORDER_MIN_USD=1000`
- `TAG_MIN_ORDER_USD=3000`
- `WHALE_MIN_BALANCE_USD=30000`
- `INSIDER_MAX_ACCOUNT_AGE_DAYS=30`

## 5) Deprecated API Surface

These are removed from active product contracts:

- `/signals/pulse-board`
- `/signals/conviction-map`
- `/signals/drift`
- `/signals/edge-window`
- `/signals/hits`
- `/signals/catalyst-feed`
- `/signals/shadow-watch`
- `/signals/retail-pressure`
- `/wallets/:walletAddress/profile`
