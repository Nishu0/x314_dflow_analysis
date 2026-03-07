import { sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import {
  analysisRuns,
  events,
  markets,
  tradeFacts,
  walletAttributions,
  walletProfiles
} from "../../db/schema";

// 4. GET /api/v1/platform/stats - Platform-wide aggregate stats
export const v1PlatformRoutes = new Elysia({ prefix: "/platform" }).get(
  "/stats",
  async ({ query }) => {
    const windowHours = query.windowHours ?? 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const statsRows = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM markets) AS total_markets,
        (SELECT COUNT(*)::int FROM markets WHERE status = 'active') AS active_markets,
        (SELECT COUNT(*)::int FROM markets WHERE status = 'determined') AS resolved_markets,
        (SELECT COUNT(*)::int FROM markets
          WHERE close_time >= NOW() AND close_time < NOW() + INTERVAL '1 day') AS closing_today,
        (SELECT COUNT(*)::int FROM markets
          WHERE close_time >= NOW() AND close_time < NOW() + INTERVAL '7 days') AS closing_this_week,
        (SELECT COUNT(*)::int FROM markets
          WHERE close_time >= NOW() AND close_time < NOW() + INTERVAL '30 days') AS closing_this_month,
        (SELECT COUNT(*)::int FROM events) AS total_categories,
        (SELECT COUNT(*)::int FROM trade_facts WHERE created_time >= ${since}) AS window_trades,
        (SELECT COALESCE(SUM(notional_usd_est::numeric), 0) FROM trade_facts WHERE created_time >= ${since}) AS window_volume_usd,
        (SELECT COUNT(*)::int FROM trade_facts WHERE created_time >= ${since} AND notional_usd_est::numeric >= 1000) AS window_large_orders,
        (SELECT COUNT(DISTINCT wallet_address)::int FROM wallet_attributions WHERE attributed_time >= ${since}) AS window_active_wallets,
        (SELECT COUNT(*)::int FROM wallet_profiles) AS total_scored_wallets,
        (SELECT COUNT(*)::int FROM wallet_attributions) AS total_attributions,
        (SELECT COUNT(*)::int FROM analysis_runs WHERE status = 'SUCCEEDED') AS total_analysis_runs,
        (SELECT run_id FROM analysis_runs WHERE status = 'SUCCEEDED' ORDER BY finished_at DESC LIMIT 1) AS latest_run_id,
        (SELECT finished_at FROM analysis_runs WHERE status = 'SUCCEEDED' ORDER BY finished_at DESC LIMIT 1) AS latest_run_at
    `);

    const s = (statsRows.rows as any[])[0] ?? {};

    // Top category by window volume
    const topCategoryRows = await db.execute(sql`
      SELECT e.series_ticker AS category, SUM(tf.notional_usd_est::numeric) AS vol
      FROM trade_facts tf
      JOIN markets m ON m.market_ticker = tf.market_ticker
      JOIN events e ON e.event_ticker = m.event_ticker
      WHERE tf.created_time >= ${since}
      GROUP BY e.series_ticker
      ORDER BY vol DESC NULLS LAST
      LIMIT 1
    `);
    const topCategory = (topCategoryRows.rows as any[])[0]?.category ?? null;

    // Most active market in window
    const topMarketRows = await db.execute(sql`
      SELECT market_ticker, SUM(notional_usd_est::numeric) AS vol
      FROM trade_facts
      WHERE created_time >= ${since}
      GROUP BY market_ticker
      ORDER BY vol DESC NULLS LAST
      LIMIT 1
    `);
    const topMarket = (topMarketRows.rows as any[])[0]?.market_ticker ?? null;

    return {
      generatedAt: new Date().toISOString(),
      windowHours,
      markets: {
        total: Number(s.total_markets ?? 0),
        active: Number(s.active_markets ?? 0),
        resolved: Number(s.resolved_markets ?? 0),
        closingToday: Number(s.closing_today ?? 0),
        closingThisWeek: Number(s.closing_this_week ?? 0),
        closingThisMonth: Number(s.closing_this_month ?? 0)
      },
      categories: {
        total: Number(s.total_categories ?? 0),
        topByVolume: topCategory
      },
      tradeActivity: {
        windowTrades: Number(s.window_trades ?? 0),
        windowVolumeUsd: Number(Number(s.window_volume_usd ?? 0).toFixed(2)),
        windowLargeOrders: Number(s.window_large_orders ?? 0),
        windowActiveWallets: Number(s.window_active_wallets ?? 0),
        topMarketByVolume: topMarket
      },
      walletIntelligence: {
        totalScoredWallets: Number(s.total_scored_wallets ?? 0),
        totalAttributions: Number(s.total_attributions ?? 0)
      },
      analysis: {
        totalRuns: Number(s.total_analysis_runs ?? 0),
        latestRunId: s.latest_run_id ?? null,
        latestRunAt: s.latest_run_at ?? null
      }
    };
  },
  {
    query: t.Object({
      windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 }))
    })
  }
);
