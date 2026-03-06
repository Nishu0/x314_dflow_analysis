# x314 Ops Runbook (Wallet-First)

## Runtime Health Checklist

1. Check `GET /health`:
   - `queue.lastCompletedAt` updated within 2 minutes
   - `queue.latestSuccessfulRunId` is not null
   - `queue.lastError` is null
2. Check public API freshness:
   - `GET /markets`
   - `GET /markets/:marketTicker/details`
3. Check strict attribution path:
   - `POST /internal/rpc-attribution`
   - `GET /internal/rpc-replay/:signature`

## Incident: Stale Market Output

Symptoms:

- `/markets` returns stale `generatedAt`
- `/markets/:marketTicker/details` has outdated holder signals

Actions:

1. Verify Redis and Postgres connectivity.
2. Inspect `/health.queue.lastError`.
3. Restart backend worker process.
4. Confirm a new `SUCCEEDED` row in `analysis_runs`.

## Incident: No Tagged Holders in Details

Symptoms:

- market details returns empty `holders[]` for active markets

Actions:

1. Verify strict attribution ingestion is active (`wallet_attributions` growth).
2. Confirm attribution sources are `helius_enhanced` or `rpc_replay`.
3. Validate thresholds:
   - `LARGE_ORDER_MIN_USD`
   - `TAG_MIN_ORDER_USD`
   - `WHALE_MIN_BALANCE_USD`
   - `INSIDER_MAX_ACCOUNT_AGE_DAYS`
4. Re-run attribution for known signatures using internal endpoints.

## Incident: RPC Attribution Failures

Symptoms:

- no growth in `wallet_attributions`
- `/internal/rpc-attribution` returns 401/5xx

Actions:

1. Verify `INTERNAL_API_TOKEN` and request header.
2. Verify `SOLANA_RPC_URL` reachability.
3. Inspect a failing signature via `/internal/rpc-replay/:signature`.
4. Re-submit attribution after fixing RPC/auth.

## Rollback Plan

1. Stop backend service to halt queue worker.
2. Roll back to previous release image.
3. Keep database state; reads continue from wallet-first attribution data and market tables.
