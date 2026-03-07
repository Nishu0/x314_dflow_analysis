import { and, desc, gte, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { env } from "../../config";
import { db } from "../../db/client";
import { markets, tradeFacts } from "../../db/schema";
import { inArray } from "drizzle-orm";

// 15. GET /api/v1/trades/whales - Large whale trades (Catalyst Feed)
export const v1TradeRoutes = new Elysia({ prefix: "/trades" }).get(
  "/whales",
  async ({ query }) => {
    const { windowHours = 24, minUsd = env.LARGE_ORDER_MIN_USD, limit = 50 } = query;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const trades = await db
      .select()
      .from(tradeFacts)
      .where(
        and(
          gte(tradeFacts.createdTime, since),
          gte(tradeFacts.notionalUsdEst, String(minUsd))
        )
      )
      .orderBy(desc(tradeFacts.notionalUsdEst))
      .limit(limit);

    const tickers = [...new Set(trades.map((t) => t.marketTicker))].filter(Boolean);
    const marketRows =
      tickers.length > 0
        ? await db.select().from(markets).where(inArray(markets.marketTicker, tickers))
        : [];
    const byTicker = new Map(marketRows.map((m) => [m.marketTicker, m]));

    // Stats for the window
    const statsRow = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_large_orders,
        COALESCE(SUM(notional_usd_est::numeric), 0) AS total_notional,
        COUNT(DISTINCT market_ticker)::int AS distinct_markets
      FROM trade_facts
      WHERE created_time >= ${since}
        AND notional_usd_est::numeric >= ${minUsd}
    `);
    const st = (statsRow.rows as any[])[0] ?? {};

    return {
      generatedAt: new Date().toISOString(),
      windowHours,
      minUsd,
      summary: {
        totalLargeOrders: Number(st.total_large_orders ?? 0),
        totalNotionalUsd: Number(Number(st.total_notional ?? 0).toFixed(2)),
        distinctMarkets: Number(st.distinct_markets ?? 0)
      },
      count: trades.length,
      trades: trades.map((t) => {
        const m = byTicker.get(t.marketTicker);
        return {
          tradeId: t.tradeId,
          time: t.createdTime.toISOString(),
          marketTicker: t.marketTicker,
          marketTitle: m?.title ?? t.marketTicker,
          takerSide: t.takerSide,
          count: t.count,
          yesPriceDollars: t.yesPriceDollars ? Number(t.yesPriceDollars) : null,
          noPriceDollars: t.noPriceDollars ? Number(t.noPriceDollars) : null,
          notionalUsdEst: t.notionalUsdEst ? Number(t.notionalUsdEst) : null,
          marketStatus: m?.status ?? null,
          marketCloseTime: m?.closeTime?.toISOString() ?? null
        };
      })
    };
  },
  {
    query: t.Object({
      windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
      minUsd: t.Optional(t.Numeric({ minimum: 100 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 }))
    })
  }
);
