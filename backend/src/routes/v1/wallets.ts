import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { env } from "../../config";
import { db } from "../../db/client";
import {
  markets,
  tradeFacts,
  walletAttributions,
  walletOutcomes,
  walletProfiles
} from "../../db/schema";

function windowSince(windowHours: number): Date {
  return new Date(Date.now() - windowHours * 60 * 60 * 1000);
}

export const v1WalletRoutes = new Elysia({ prefix: "/wallets" })

  // 17. POST /profile - Full wallet dossier (Resolution Memory + Conviction Map)
  .post(
    "/profile",
    async ({ body, set }) => {
      const { walletAddress, windowHours = 168 } = body; // default 7 days
      const since = windowSince(windowHours);

      const profileRows = await db
        .select()
        .from(walletProfiles)
        .where(eq(walletProfiles.walletAddress, walletAddress))
        .limit(1);

      const attrRows = await db
        .select()
        .from(walletAttributions)
        .where(
          and(
            eq(walletAttributions.walletAddress, walletAddress),
            gte(walletAttributions.attributedTime, since)
          )
        )
        .orderBy(desc(walletAttributions.attributedTime))
        .limit(200);

      if (profileRows.length === 0 && attrRows.length === 0) {
        set.status = 404;
        return { error: "NotFound", message: `No data found for wallet ${walletAddress}` };
      }

      const profile = profileRows[0] ?? null;
      const outcomeRows = await db
        .select()
        .from(walletOutcomes)
        .where(eq(walletOutcomes.walletAddress, walletAddress))
        .orderBy(desc(walletOutcomes.createdAt))
        .limit(100);

      // Compute stats from attributions
      const uniqueMarkets = new Set(attrRows.map((a) => a.marketTicker));
      const totalUsd = attrRows.reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
      const yesUsd = attrRows.filter((a) => a.side === "YES").reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
      const noUsd = attrRows.filter((a) => a.side === "NO").reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
      const largeOrders = attrRows.filter((a) => Number(a.sizeUsdEst ?? 0) >= env.LARGE_ORDER_MIN_USD);

      // Wallet age from first attribution
      const allAttrRows = await db
        .select({ attributedTime: walletAttributions.attributedTime })
        .from(walletAttributions)
        .where(
          and(
            eq(walletAttributions.walletAddress, walletAddress),
            inArray(walletAttributions.source, ["helius_enhanced", "rpc_replay"])
          )
        )
        .orderBy(asc(walletAttributions.attributedTime))
        .limit(1);

      const firstSeen = allAttrRows[0]?.attributedTime ?? null;
      const walletAgeDays = firstSeen
        ? Math.floor((Date.now() - firstSeen.getTime()) / (24 * 60 * 60 * 1000))
        : null;

      const isInsider =
        typeof walletAgeDays === "number" &&
        walletAgeDays <= env.INSIDER_MAX_ACCOUNT_AGE_DAYS &&
        totalUsd >= env.TAG_MIN_ORDER_USD;

      // Resolved outcomes
      const wonOutcomes = outcomeRows.filter((o) => o.won === true);
      const lostOutcomes = outcomeRows.filter((o) => o.won === false);
      const totalPnl = outcomeRows.reduce((acc, o) => acc + Number(o.realizedPnlEst ?? 0), 0);

      return {
        generatedAt: new Date().toISOString(),
        walletAddress,
        windowHours,
        classification: {
          isInsider,
          walletAgeDays,
          firstSeenAt: firstSeen?.toISOString() ?? null,
          tag: isInsider ? "INSIDER" : walletAgeDays !== null && walletAgeDays > env.INSIDER_MAX_ACCOUNT_AGE_DAYS ? "VETERAN" : "UNKNOWN"
        },
        qualityMetrics: profile
          ? {
              qualityScore: profile.qualityScore ? Number(profile.qualityScore) : null,
              hitRate: profile.hitRate ? Number(profile.hitRate) : null,
              timingScore: profile.timingScore ? Number(profile.timingScore) : null,
              specializationScore: profile.specializationScore ? Number(profile.specializationScore) : null,
              disciplineScore: profile.disciplineScore ? Number(profile.disciplineScore) : null,
              category: profile.categoryNormalized ?? profile.categoryRaw ?? null,
              lastScoredAt: profile.lastScoredAt?.toISOString() ?? null,
              sampleSize: profile.sampleSize
            }
          : null,
        tradingActivity: {
          windowTrades: attrRows.length,
          uniqueMarkets: uniqueMarkets.size,
          totalUsd: Number(totalUsd.toFixed(2)),
          yesUsd: Number(yesUsd.toFixed(2)),
          noUsd: Number(noUsd.toFixed(2)),
          largeOrderCount: largeOrders.length,
          bias: yesUsd > noUsd ? "YES" : noUsd > yesUsd ? "NO" : "NEUTRAL"
        },
        outcomes: {
          totalResolved: outcomeRows.length,
          wins: wonOutcomes.length,
          losses: lostOutcomes.length,
          winRate: outcomeRows.length > 0 ? Number((wonOutcomes.length / outcomeRows.length).toFixed(3)) : null,
          totalRealizedPnl: Number(totalPnl.toFixed(2))
        },
        recentTrades: attrRows.slice(0, 20).map((a) => ({
          marketTicker: a.marketTicker,
          side: a.side,
          sizeUsd: Number(a.sizeUsdEst ?? 0),
          attributedAt: a.attributedTime.toISOString(),
          confidence: Number(a.attributionConfidence),
          source: a.source
        }))
      };
    },
    {
      body: t.Object({
        walletAddress: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 18. POST /activity - Recent trading activity for a wallet
  .post(
    "/activity",
    async ({ body, set }) => {
      const { walletAddress, windowHours = 168, limit = 100 } = body;
      const since = windowSince(windowHours);

      const attrRows = await db
        .select()
        .from(walletAttributions)
        .where(
          and(
            eq(walletAttributions.walletAddress, walletAddress),
            gte(walletAttributions.attributedTime, since)
          )
        )
        .orderBy(desc(walletAttributions.attributedTime))
        .limit(limit);

      if (attrRows.length === 0) {
        return {
          generatedAt: new Date().toISOString(),
          walletAddress,
          windowHours,
          count: 0,
          activity: []
        };
      }

      const tickers = [...new Set(attrRows.map((a) => a.marketTicker))].filter(Boolean);
      const marketRows =
        tickers.length > 0
          ? await db.select().from(markets).where(inArray(markets.marketTicker, tickers))
          : [];
      const byTicker = new Map(marketRows.map((m) => [m.marketTicker, m]));

      const totalUsd = attrRows.reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
      const yesUsd = attrRows.filter((a) => a.side === "YES").reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
      const noUsd = attrRows.filter((a) => a.side === "NO").reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);

      return {
        generatedAt: new Date().toISOString(),
        walletAddress,
        windowHours,
        summary: {
          tradeCount: attrRows.length,
          uniqueMarkets: tickers.length,
          totalUsd: Number(totalUsd.toFixed(2)),
          yesUsd: Number(yesUsd.toFixed(2)),
          noUsd: Number(noUsd.toFixed(2)),
          bias: yesUsd > noUsd ? "YES" : noUsd > yesUsd ? "NO" : "NEUTRAL"
        },
        count: attrRows.length,
        activity: attrRows.map((a) => {
          const m = byTicker.get(a.marketTicker);
          return {
            attributionId: a.attributionId,
            marketTicker: a.marketTicker,
            marketTitle: m?.title ?? a.marketTicker,
            marketStatus: m?.status ?? null,
            side: a.side,
            sizeUsd: Number(a.sizeUsdEst ?? 0),
            sizeContracts: a.sizeContracts ? Number(a.sizeContracts) : null,
            attributedAt: a.attributedTime.toISOString(),
            confidence: Number(a.attributionConfidence),
            source: a.source
          };
        })
      };
    },
    {
      body: t.Object({
        walletAddress: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 }))
      })
    }
  )

  // 19. POST /pnl-breakdown - Per-market PnL breakdown
  .post(
    "/pnl-breakdown",
    async ({ body }) => {
      const { walletAddress } = body;

      const outcomes = await db
        .select()
        .from(walletOutcomes)
        .where(eq(walletOutcomes.walletAddress, walletAddress))
        .orderBy(desc(walletOutcomes.createdAt));

      const tickers = [...new Set(outcomes.map((o) => o.marketTicker))].filter(Boolean);
      const marketRows =
        tickers.length > 0
          ? await db.select().from(markets).where(inArray(markets.marketTicker, tickers))
          : [];
      const byTicker = new Map(marketRows.map((m) => [m.marketTicker, m]));

      const totalPnl = outcomes.reduce((acc, o) => acc + Number(o.realizedPnlEst ?? 0), 0);
      const resolved = outcomes.filter((o) => o.resolved);
      const wins = resolved.filter((o) => o.won === true);
      const losses = resolved.filter((o) => o.won === false);

      return {
        generatedAt: new Date().toISOString(),
        walletAddress,
        summary: {
          totalMarkets: outcomes.length,
          resolvedMarkets: resolved.length,
          wins: wins.length,
          losses: losses.length,
          winRate: resolved.length > 0 ? Number((wins.length / resolved.length).toFixed(3)) : null,
          totalRealizedPnl: Number(totalPnl.toFixed(2)),
          totalWinPnl: Number(wins.reduce((a, o) => a + Number(o.realizedPnlEst ?? 0), 0).toFixed(2)),
          totalLossPnl: Number(losses.reduce((a, o) => a + Number(o.realizedPnlEst ?? 0), 0).toFixed(2))
        },
        breakdown: outcomes.map((o) => {
          const m = byTicker.get(o.marketTicker);
          return {
            marketTicker: o.marketTicker,
            marketTitle: m?.title ?? o.marketTicker,
            side: o.side,
            resolved: o.resolved,
            won: o.won,
            realizedPnl: o.realizedPnlEst ? Number(o.realizedPnlEst) : null,
            enteredAt: o.enteredAt?.toISOString() ?? null,
            exitedAt: o.exitedAt?.toISOString() ?? null,
            marketResult: m?.result ?? null
          };
        })
      };
    },
    {
      body: t.Object({
        walletAddress: t.String()
      })
    }
  )

  // 20. POST /compare - Compare 2-5 wallets side-by-side
  .post(
    "/compare",
    async ({ body, set }) => {
      const { walletAddresses, windowHours = 168 } = body;
      if (walletAddresses.length < 2 || walletAddresses.length > 5) {
        set.status = 400;
        return { error: "ValidationError", message: "Provide 2-5 wallet addresses" };
      }
      const since = windowSince(windowHours);

      const profiles = await db
        .select()
        .from(walletProfiles)
        .where(inArray(walletProfiles.walletAddress, walletAddresses));
      const profileByAddress = new Map(profiles.map((p) => [p.walletAddress, p]));

      const comparison = await Promise.all(
        walletAddresses.map(async (addr) => {
          const attrRows = await db
            .select()
            .from(walletAttributions)
            .where(
              and(
                eq(walletAttributions.walletAddress, addr),
                gte(walletAttributions.attributedTime, since)
              )
            );

          const profile = profileByAddress.get(addr);
          const totalUsd = attrRows.reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
          const yesUsd = attrRows.filter((a) => a.side === "YES").reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
          const noUsd = attrRows.filter((a) => a.side === "NO").reduce((acc, a) => acc + Number(a.sizeUsdEst ?? 0), 0);
          const uniqueMarkets = new Set(attrRows.map((a) => a.marketTicker)).size;

          return {
            walletAddress: addr,
            qualityScore: profile?.qualityScore ? Number(profile.qualityScore) : null,
            hitRate: profile?.hitRate ? Number(profile.hitRate) : null,
            timingScore: profile?.timingScore ? Number(profile.timingScore) : null,
            disciplineScore: profile?.disciplineScore ? Number(profile.disciplineScore) : null,
            category: profile?.categoryNormalized ?? null,
            windowActivity: {
              tradeCount: attrRows.length,
              uniqueMarkets,
              totalUsd: Number(totalUsd.toFixed(2)),
              yesUsd: Number(yesUsd.toFixed(2)),
              noUsd: Number(noUsd.toFixed(2)),
              bias: yesUsd > noUsd ? "YES" : noUsd > yesUsd ? "NO" : "NEUTRAL"
            }
          };
        })
      );

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        walletCount: walletAddresses.length,
        comparison
      };
    },
    {
      body: t.Object({
        walletAddresses: t.Array(t.String(), { minItems: 2, maxItems: 5 }),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 21. POST /copy-traders - Detect wallets copying a target wallet
  .post(
    "/copy-traders",
    async ({ body }) => {
      const { walletAddress, windowHours = 168, maxLagHours = 24 } = body;
      const since = windowSince(windowHours);

      const copyRows = await db.execute(sql`
        WITH target_trades AS (
          SELECT market_ticker, attributed_time, side
          FROM wallet_attributions
          WHERE wallet_address = ${walletAddress}
            AND attributed_time >= ${since}
        )
        SELECT
          wa.wallet_address AS copier,
          COUNT(DISTINCT tt.market_ticker)::int AS shared_markets,
          AVG(EXTRACT(EPOCH FROM (wa.attributed_time - tt.attributed_time)))::numeric AS avg_lag_seconds,
          MIN(EXTRACT(EPOCH FROM (wa.attributed_time - tt.attributed_time)))::numeric AS min_lag_seconds
        FROM target_trades tt
        JOIN wallet_attributions wa
          ON wa.market_ticker = tt.market_ticker
          AND wa.wallet_address != ${walletAddress}
          AND wa.attributed_time > tt.attributed_time
          AND wa.attributed_time <= tt.attributed_time + ${maxLagHours} * INTERVAL '1 hour'
          AND wa.side = tt.side
        GROUP BY wa.wallet_address
        HAVING COUNT(DISTINCT tt.market_ticker) >= 2
        ORDER BY shared_markets DESC, avg_lag_seconds ASC
        LIMIT 20
      `);

      type CopyRow = {
        copier: string;
        shared_markets: number;
        avg_lag_seconds: string;
        min_lag_seconds: string;
      };

      return {
        generatedAt: new Date().toISOString(),
        targetWallet: walletAddress,
        windowHours,
        maxLagHours,
        count: (copyRows.rows as CopyRow[]).length,
        copyTraders: (copyRows.rows as CopyRow[]).map((r) => ({
          walletAddress: r.copier,
          sharedMarkets: Number(r.shared_markets),
          avgLagSeconds: Number(Number(r.avg_lag_seconds ?? 0).toFixed(0)),
          minLagSeconds: Number(Number(r.min_lag_seconds ?? 0).toFixed(0)),
          copyScore: Math.min(
            100,
            Math.round(Number(r.shared_markets) * 20 + Math.max(0, 100 - Number(r.avg_lag_seconds ?? 0) / 360))
          )
        }))
      };
    },
    {
      body: t.Object({
        walletAddress: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 })),
        maxLagHours: t.Optional(t.Number({ minimum: 1, maximum: 168 }))
      })
    }
  )

  // 22. GET /top-performers - Leaderboard by PnL, ROI, Sharpe, win rate, volume
  .get(
    "/top-performers",
    async ({ query }) => {
      const { limit = 50, sortBy = "qualityScore" } = query;

      const validSorts: Record<string, string> = {
        qualityScore: "quality_score",
        hitRate: "hit_rate",
        timingScore: "timing_score",
        disciplineScore: "discipline_score",
        specializationScore: "specialization_score"
      };
      const orderCol = validSorts[sortBy] ?? "quality_score";

      const rows = await db.execute(sql`
        SELECT
          wp.*,
          (
            SELECT COUNT(*)::int
            FROM wallet_attributions wa
            WHERE wa.wallet_address = wp.wallet_address
              AND wa.attributed_time >= NOW() - INTERVAL '7 days'
          ) AS recent_trades,
          (
            SELECT COALESCE(SUM(size_usd_est::numeric), 0)
            FROM wallet_attributions wa
            WHERE wa.wallet_address = wp.wallet_address
              AND wa.attributed_time >= NOW() - INTERVAL '7 days'
          ) AS recent_volume_usd,
          (
            SELECT COUNT(*)::int FROM wallet_outcomes wo
            WHERE wo.wallet_address = wp.wallet_address AND wo.resolved = true AND wo.won = true
          ) AS total_wins,
          (
            SELECT COUNT(*)::int FROM wallet_outcomes wo
            WHERE wo.wallet_address = wp.wallet_address AND wo.resolved = true
          ) AS total_resolved
        FROM wallet_profiles wp
        WHERE wp.quality_score IS NOT NULL
        ORDER BY ${sql.raw(orderCol)} DESC NULLS LAST
        LIMIT ${limit}
      `);

      type ProfileRow = {
        wallet_address: string;
        quality_score: string | null;
        hit_rate: string | null;
        timing_score: string | null;
        specialization_score: string | null;
        discipline_score: string | null;
        category_normalized: string | null;
        category_raw: string | null;
        sample_size: number;
        last_scored_at: string | null;
        recent_trades: number;
        recent_volume_usd: string;
        total_wins: number;
        total_resolved: number;
      };

      return {
        generatedAt: new Date().toISOString(),
        sortBy,
        limit,
        count: (rows.rows as ProfileRow[]).length,
        leaderboard: (rows.rows as ProfileRow[]).map((r, idx) => ({
          rank: idx + 1,
          walletAddress: r.wallet_address,
          qualityScore: r.quality_score ? Number(r.quality_score) : null,
          hitRate: r.hit_rate ? Number(r.hit_rate) : null,
          timingScore: r.timing_score ? Number(r.timing_score) : null,
          specializationScore: r.specialization_score ? Number(r.specialization_score) : null,
          disciplineScore: r.discipline_score ? Number(r.discipline_score) : null,
          category: r.category_normalized ?? r.category_raw ?? null,
          sampleSize: Number(r.sample_size),
          lastScoredAt: r.last_scored_at,
          recentActivity: {
            trades: Number(r.recent_trades ?? 0),
            volumeUsd: Number(Number(r.recent_volume_usd ?? 0).toFixed(2))
          },
          resolutionRecord: {
            wins: Number(r.total_wins ?? 0),
            resolved: Number(r.total_resolved ?? 0),
            winRate:
              Number(r.total_resolved) > 0
                ? Number((Number(r.total_wins) / Number(r.total_resolved)).toFixed(3))
                : null
          }
        }))
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        sortBy: t.Optional(
          t.Union([
            t.Literal("qualityScore"),
            t.Literal("hitRate"),
            t.Literal("timingScore"),
            t.Literal("disciplineScore"),
            t.Literal("specializationScore")
          ])
        )
      })
    }
  )

  // 23. GET /niche-experts - Top wallets in a specific category
  .get(
    "/niche-experts",
    async ({ query, set }) => {
      const { category, limit = 20, windowHours = 168 } = query;
      if (!category) {
        set.status = 400;
        return { error: "ValidationError", message: "category is required" };
      }
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        SELECT
          wp.wallet_address,
          wp.quality_score,
          wp.hit_rate,
          wp.specialization_score,
          wp.timing_score,
          wp.discipline_score,
          wp.category_normalized,
          wp.category_raw,
          wp.sample_size,
          COALESCE((
            SELECT SUM(wa.size_usd_est::numeric)
            FROM wallet_attributions wa
            JOIN markets m ON m.market_ticker = wa.market_ticker
            JOIN events e ON e.event_ticker = m.event_ticker
            WHERE wa.wallet_address = wp.wallet_address
              AND wa.attributed_time >= ${since}
              AND e.series_ticker ILIKE ${`%${category}%`}
          ), 0) AS category_volume_usd,
          (
            SELECT COUNT(*)::int
            FROM wallet_attributions wa
            JOIN markets m ON m.market_ticker = wa.market_ticker
            JOIN events e ON e.event_ticker = m.event_ticker
            WHERE wa.wallet_address = wp.wallet_address
              AND wa.attributed_time >= ${since}
              AND e.series_ticker ILIKE ${`%${category}%`}
          ) AS category_trades
        FROM wallet_profiles wp
        WHERE wp.quality_score IS NOT NULL
          AND (
            wp.category_normalized ILIKE ${`%${category}%`}
            OR wp.category_raw ILIKE ${`%${category}%`}
            OR EXISTS (
              SELECT 1 FROM wallet_attributions wa
              JOIN markets m ON m.market_ticker = wa.market_ticker
              JOIN events e ON e.event_ticker = m.event_ticker
              WHERE wa.wallet_address = wp.wallet_address
                AND e.series_ticker ILIKE ${`%${category}%`}
                LIMIT 1
            )
          )
        ORDER BY category_volume_usd DESC NULLS LAST, wp.quality_score DESC NULLS LAST
        LIMIT ${limit}
      `);

      type ExpertRow = {
        wallet_address: string;
        quality_score: string | null;
        hit_rate: string | null;
        specialization_score: string | null;
        timing_score: string | null;
        discipline_score: string | null;
        category_normalized: string | null;
        category_raw: string | null;
        sample_size: number;
        category_volume_usd: string;
        category_trades: number;
      };

      return {
        generatedAt: new Date().toISOString(),
        category,
        windowHours,
        count: (rows.rows as ExpertRow[]).length,
        experts: (rows.rows as ExpertRow[]).map((r, idx) => ({
          rank: idx + 1,
          walletAddress: r.wallet_address,
          qualityScore: r.quality_score ? Number(r.quality_score) : null,
          hitRate: r.hit_rate ? Number(r.hit_rate) : null,
          specializationScore: r.specialization_score ? Number(r.specialization_score) : null,
          timingScore: r.timing_score ? Number(r.timing_score) : null,
          disciplineScore: r.discipline_score ? Number(r.discipline_score) : null,
          category: r.category_normalized ?? r.category_raw ?? null,
          sampleSize: Number(r.sample_size),
          categoryActivity: {
            volumeUsd: Number(Number(r.category_volume_usd).toFixed(2)),
            tradeCount: Number(r.category_trades)
          }
        }))
      };
    },
    {
      query: t.Object({
        category: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 25. GET /alpha-callers - Wallets that trade early on later-trending markets
  .get(
    "/alpha-callers",
    async ({ query }) => {
      const { limit = 20, windowHours = 336 } = query; // default 14 days
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        WITH market_volume_stats AS (
          SELECT
            market_ticker,
            MIN(created_time) AS first_trade_time,
            MAX(created_time) AS last_trade_time,
            SUM(notional_usd_est::numeric) AS total_volume
          FROM trade_facts
          WHERE created_time >= ${since}
          GROUP BY market_ticker
          HAVING SUM(notional_usd_est::numeric) > 5000
        ),
        early_cutoffs AS (
          SELECT
            market_ticker,
            first_trade_time,
            first_trade_time + (last_trade_time - first_trade_time) * 0.2 AS early_cutoff,
            total_volume
          FROM market_volume_stats
        ),
        early_wallets AS (
          SELECT
            wa.wallet_address,
            wa.market_ticker,
            ec.total_volume
          FROM wallet_attributions wa
          JOIN early_cutoffs ec ON ec.market_ticker = wa.market_ticker
          WHERE wa.attributed_time >= ${since}
            AND wa.attributed_time <= ec.early_cutoff
            AND wa.attribution_confidence::numeric >= 0.7
        )
        SELECT
          wallet_address,
          COUNT(DISTINCT market_ticker)::int AS early_market_count,
          SUM(total_volume) AS total_volume_called,
          AVG(total_volume) AS avg_volume_per_call
        FROM early_wallets
        GROUP BY wallet_address
        HAVING COUNT(DISTINCT market_ticker) >= 2
        ORDER BY total_volume_called DESC NULLS LAST, early_market_count DESC
        LIMIT ${limit}
      `);

      type AlphaRow = {
        wallet_address: string;
        early_market_count: number;
        total_volume_called: string;
        avg_volume_per_call: string;
      };

      // Enrich with wallet profiles
      const addresses = (rows.rows as AlphaRow[]).map((r) => r.wallet_address);
      const profileRows =
        addresses.length > 0
          ? await db.select().from(walletProfiles).where(inArray(walletProfiles.walletAddress, addresses))
          : [];
      const profileByAddr = new Map(profileRows.map((p) => [p.walletAddress, p]));

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        count: (rows.rows as AlphaRow[]).length,
        alphaCallers: (rows.rows as AlphaRow[]).map((r, idx) => {
          const profile = profileByAddr.get(r.wallet_address);
          return {
            rank: idx + 1,
            walletAddress: r.wallet_address,
            earlyMarketCount: Number(r.early_market_count),
            totalVolumeCalledUsd: Number(Number(r.total_volume_called ?? 0).toFixed(2)),
            avgVolumePerCallUsd: Number(Number(r.avg_volume_per_call ?? 0).toFixed(2)),
            qualityScore: profile?.qualityScore ? Number(profile.qualityScore) : null,
            hitRate: profile?.hitRate ? Number(profile.hitRate) : null,
            category: profile?.categoryNormalized ?? null
          };
        })
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        windowHours: t.Optional(t.Numeric({ minimum: 24, maximum: 8760 }))
      })
    }
  )

  // 27. GET /insiders - Global insider candidates by behavioral score
  .get(
    "/insiders",
    async ({ query }) => {
      const { windowHours = 168, limit = 30 } = query;
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        WITH wallet_first_seen AS (
          SELECT wallet_address, MIN(attributed_time) AS first_seen_at
          FROM wallet_attributions
          WHERE source IN ('helius_enhanced', 'rpc_replay')
          GROUP BY wallet_address
        ),
        insider_candidates AS (
          SELECT
            wa.wallet_address,
            wfs.first_seen_at,
            EXTRACT(EPOCH FROM (NOW() - wfs.first_seen_at)) / 86400 AS wallet_age_days,
            COUNT(DISTINCT wa.market_ticker)::int AS markets_traded,
            SUM(wa.size_usd_est::numeric) AS total_usd,
            COUNT(*)::int AS order_count,
            AVG(wa.attribution_confidence::numeric) AS avg_confidence,
            COUNT(DISTINCT wa.side)::int AS sides_traded
          FROM wallet_attributions wa
          JOIN wallet_first_seen wfs ON wfs.wallet_address = wa.wallet_address
          WHERE wa.attributed_time >= ${since}
            AND wa.size_usd_est::numeric >= ${env.LARGE_ORDER_MIN_USD}
            AND wa.attribution_confidence::numeric >= 0.7
            AND wa.source IN ('helius_enhanced', 'rpc_replay')
          GROUP BY wa.wallet_address, wfs.first_seen_at
          HAVING SUM(wa.size_usd_est::numeric) >= ${env.TAG_MIN_ORDER_USD}
            AND EXTRACT(EPOCH FROM (NOW() - wfs.first_seen_at)) / 86400 <= ${env.INSIDER_MAX_ACCOUNT_AGE_DAYS}
        )
        SELECT *,
          LEAST(100, ROUND(
            50 +
            LEAST(total_usd / 1000, 30) +
            LEAST(markets_traded * 5, 15) +
            (CASE WHEN avg_confidence >= 0.9 THEN 5 ELSE 0 END)
          ))::int AS insider_score
        FROM insider_candidates
        ORDER BY insider_score DESC, total_usd DESC NULLS LAST
        LIMIT ${limit}
      `);

      type InsiderRow = {
        wallet_address: string;
        first_seen_at: string;
        wallet_age_days: string;
        markets_traded: number;
        total_usd: string;
        order_count: number;
        avg_confidence: string;
        sides_traded: number;
        insider_score: number;
      };

      // Get traded market tickers for each insider
      const insiders = await Promise.all(
        (rows.rows as InsiderRow[]).map(async (r, idx) => {
          const marketTickers = await db
            .select({ marketTicker: walletAttributions.marketTicker })
            .from(walletAttributions)
            .where(
              and(
                eq(walletAttributions.walletAddress, r.wallet_address),
                gte(walletAttributions.attributedTime, since)
              )
            )
            .groupBy(walletAttributions.marketTicker)
            .limit(10);

          return {
            rank: idx + 1,
            walletAddress: r.wallet_address,
            insiderScore: Number(r.insider_score),
            walletAgeDays: Math.round(Number(r.wallet_age_days ?? 0)),
            firstSeenAt: r.first_seen_at,
            marketsTraded: Number(r.markets_traded),
            totalUsd: Number(Number(r.total_usd).toFixed(2)),
            orderCount: Number(r.order_count),
            avgConfidence: Number(Number(r.avg_confidence).toFixed(3)),
            recentMarkets: marketTickers.map((m) => m.marketTicker),
            behaviorSignals: [
              `Wallet is only ${Math.round(Number(r.wallet_age_days ?? 0))} days old`,
              `$${Number(r.total_usd).toFixed(0)} in large orders across ${r.markets_traded} markets`,
              `${r.order_count} attributable orders with ${(Number(r.avg_confidence) * 100).toFixed(0)}% avg confidence`
            ]
          };
        })
      );

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        insiderCriteria: {
          maxWalletAgeDays: env.INSIDER_MAX_ACCOUNT_AGE_DAYS,
          minLargeOrderUsd: env.LARGE_ORDER_MIN_USD,
          minTotalOrderUsd: env.TAG_MIN_ORDER_USD
        },
        count: insiders.length,
        insiders
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
      })
    }
  );
