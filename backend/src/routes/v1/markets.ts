import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { SQL } from "drizzle-orm";
import { env } from "../../config";
import { db } from "../../db/client";
import {
  events,
  markets,
  orderbookSnapshots,
  priceSnapshots,
  tradeFacts,
  walletAttributions,
  walletProfiles
} from "../../db/schema";

function windowSince(windowHours: number): Date {
  return new Date(Date.now() - windowHours * 60 * 60 * 1000);
}

function closingBefore(closingIn: string): Date {
  const now = new Date();
  switch (closingIn) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() + 7);
      return d;
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 1);
      return d;
    }
    case "year": {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() + 1);
      return d;
    }
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

function computeOrderbookDepth(yesBids: Record<string, number>, noBids: Record<string, number>) {
  const yesBidEntries = Object.entries(yesBids).map(([price, size]) => ({
    price: Number(price),
    size: Number(size)
  }));
  const noBidEntries = Object.entries(noBids).map(([price, size]) => ({
    price: Number(price),
    size: Number(size)
  }));
  const totalYesLiquidity = yesBidEntries.reduce((acc, e) => acc + e.size, 0);
  const totalNoLiquidity = noBidEntries.reduce((acc, e) => acc + e.size, 0);
  const bestYesBid = yesBidEntries.length > 0 ? Math.max(...yesBidEntries.map((e) => e.price)) : null;
  const bestNoBid = noBidEntries.length > 0 ? Math.max(...noBidEntries.map((e) => e.price)) : null;
  return {
    yesBidLiquidity: Number(totalYesLiquidity.toFixed(4)),
    noBidLiquidity: Number(totalNoLiquidity.toFixed(4)),
    totalLiquidity: Number((totalYesLiquidity + totalNoLiquidity).toFixed(4)),
    yesLevels: yesBidEntries.length,
    noLevels: noBidEntries.length,
    bestYesBid,
    bestNoBid
  };
}

function toRow(m: typeof markets.$inferSelect) {
  return {
    marketTicker: m.marketTicker,
    eventTicker: m.eventTicker,
    title: m.title,
    subtitle: m.subtitle,
    status: m.status,
    closeTime: m.closeTime?.toISOString() ?? null,
    volume: Number(m.volume ?? 0),
    openInterest: Number(m.openInterest ?? 0),
    yesBid: m.yesBid ? Number(m.yesBid) : null,
    yesAsk: m.yesAsk ? Number(m.yesAsk) : null,
    noBid: m.noBid ? Number(m.noBid) : null,
    noAsk: m.noAsk ? Number(m.noAsk) : null
  };
}

export const v1MarketRoutes = new Elysia({ prefix: "/markets" })

  // 1. GET /trending - Pulse Board: trending markets with volume spikes
  .get(
    "/trending",
    async ({ query }) => {
      const windowHours = query.windowHours ?? 24;
      const limit = query.limit ?? 20;
      const since = windowSince(windowHours);

      const volumeRows = await db.execute(sql`
        SELECT
          tf.market_ticker,
          SUM(tf.notional_usd_est::numeric) AS total_notional,
          COUNT(*)::int AS trade_count,
          SUM(CASE WHEN tf.taker_side = 'YES' THEN tf.notional_usd_est::numeric ELSE 0 END) AS yes_notional,
          SUM(CASE WHEN tf.taker_side = 'NO'  THEN tf.notional_usd_est::numeric ELSE 0 END) AS no_notional
        FROM trade_facts tf
        WHERE tf.created_time >= ${since}
        GROUP BY tf.market_ticker
        ORDER BY total_notional DESC NULLS LAST
        LIMIT ${limit}
      `);

      const rows = volumeRows.rows as Array<{
        market_ticker: string;
        total_notional: string;
        trade_count: number;
        yes_notional: string;
        no_notional: string;
      }>;

      const tickers = rows.map((r) => r.market_ticker).filter(Boolean);
      const marketRows =
        tickers.length > 0
          ? await db.select().from(markets).where(inArray(markets.marketTicker, tickers))
          : [];
      const byTicker = new Map(marketRows.map((m) => [m.marketTicker, m]));

      const result = rows.map((r) => {
        const m = byTicker.get(r.market_ticker);
        const total = Number(r.total_notional ?? 0);
        const yes = Number(r.yes_notional ?? 0);
        const no = Number(r.no_notional ?? 0);
        return {
          marketTicker: r.market_ticker,
          title: m?.title ?? r.market_ticker,
          subtitle: m?.subtitle ?? null,
          eventTicker: m?.eventTicker ?? null,
          status: m?.status ?? null,
          closeTime: m?.closeTime?.toISOString() ?? null,
          yesBid: m?.yesBid ? Number(m.yesBid) : null,
          yesAsk: m?.yesAsk ? Number(m.yesAsk) : null,
          noBid: m?.noBid ? Number(m.noBid) : null,
          noAsk: m?.noAsk ? Number(m.noAsk) : null,
          flow: {
            totalNotionalUsd: Number(total.toFixed(2)),
            tradeCount: Number(r.trade_count),
            yesNotionalUsd: Number(yes.toFixed(2)),
            noNotionalUsd: Number(no.toFixed(2)),
            sentimentBias: yes > no ? "YES" : no > yes ? "NO" : "NEUTRAL"
          }
        };
      });

      return { generatedAt: new Date().toISOString(), windowHours, count: result.length, markets: result };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
      })
    }
  )

  // 2. GET /search - Search markets by keyword, category, status, closingIn
  .get(
    "/search",
    async ({ query }) => {
      const { q, status, closingIn, category, limit = 50 } = query;
      const now = new Date();

      const whereParts: SQL[] = [];
      if (q) {
        whereParts.push(
          sql`(m.title ILIKE ${`%${q}%`} OR m.subtitle ILIKE ${`%${q}%`} OR m.market_ticker ILIKE ${`%${q}%`} OR m.event_ticker ILIKE ${`%${q}%`})`
        );
      }
      if (status) {
        whereParts.push(sql`m.status::text = ${status}`);
      }
      if (closingIn) {
        const deadline = closingBefore(closingIn);
        whereParts.push(sql`m.close_time >= ${now} AND m.close_time <= ${deadline}`);
      }
      if (category) {
        whereParts.push(sql`e.series_ticker ILIKE ${`%${category}%`}`);
      }

      const whereClause =
        whereParts.length > 0
          ? sql`WHERE ${whereParts.reduce((acc, part) => sql`${acc} AND ${part}`)}`
          : sql``;

      const rows = await db.execute(sql`
        SELECT
          m.market_ticker, m.event_ticker, m.title, m.subtitle, m.status,
          m.close_time, m.volume, m.open_interest,
          m.yes_bid, m.yes_ask, m.no_bid, m.no_ask,
          e.series_ticker AS category
        FROM markets m
        JOIN events e ON m.event_ticker = e.event_ticker
        ${whereClause}
        ORDER BY m.last_seen_at DESC
        LIMIT ${limit}
      `);

      type SearchRow = {
        market_ticker: string;
        event_ticker: string;
        title: string;
        subtitle: string;
        status: string;
        close_time: string | null;
        volume: string;
        open_interest: string;
        yes_bid: string | null;
        yes_ask: string | null;
        no_bid: string | null;
        no_ask: string | null;
        category: string;
      };

      return {
        generatedAt: new Date().toISOString(),
        query: q ?? null,
        filters: { status: status ?? null, closingIn: closingIn ?? null, category: category ?? null },
        count: rows.rows.length,
        markets: (rows.rows as SearchRow[]).map((row) => ({
          marketTicker: row.market_ticker,
          eventTicker: row.event_ticker,
          category: row.category,
          title: row.title,
          subtitle: row.subtitle,
          status: row.status,
          closeTime: row.close_time,
          volume: Number(row.volume ?? 0),
          openInterest: Number(row.open_interest ?? 0),
          yesBid: row.yes_bid ? Number(row.yes_bid) : null,
          yesAsk: row.yes_ask ? Number(row.yes_ask) : null,
          noBid: row.no_bid ? Number(row.no_bid) : null,
          noAsk: row.no_ask ? Number(row.no_ask) : null
        }))
      };
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        status: t.Optional(t.String()),
        category: t.Optional(t.String()),
        closingIn: t.Optional(
          t.Union([t.Literal("today"), t.Literal("week"), t.Literal("month"), t.Literal("year")])
        ),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 }))
      })
    }
  )

  // 3. GET /categories - All categories with activity stats
  .get(
    "/categories",
    async ({ query }) => {
      const windowHours = query.windowHours ?? 24;
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        SELECT
          e.series_ticker AS category,
          COUNT(DISTINCT m.market_ticker)::int AS market_count,
          COUNT(DISTINCT CASE WHEN m.status = 'active' THEN m.market_ticker END)::int AS active_count,
          COUNT(DISTINCT CASE WHEN m.close_time >= NOW() AND m.close_time < NOW() + INTERVAL '1 day' THEN m.market_ticker END)::int AS closing_today,
          COUNT(DISTINCT CASE WHEN m.close_time >= NOW() AND m.close_time < NOW() + INTERVAL '7 days' THEN m.market_ticker END)::int AS closing_week,
          COALESCE(SUM(m.volume::numeric), 0) AS total_volume,
          COALESCE(SUM(m.open_interest::numeric), 0) AS total_open_interest,
          COALESCE(SUM(tf_agg.window_notional), 0) AS window_volume_usd,
          COALESCE(SUM(tf_agg.window_trades), 0)::int AS window_trade_count
        FROM events e
        JOIN markets m ON m.event_ticker = e.event_ticker
        LEFT JOIN (
          SELECT market_ticker,
            SUM(notional_usd_est::numeric) AS window_notional,
            COUNT(*)::int AS window_trades
          FROM trade_facts
          WHERE created_time >= ${since}
          GROUP BY market_ticker
        ) tf_agg ON tf_agg.market_ticker = m.market_ticker
        GROUP BY e.series_ticker
        ORDER BY window_volume_usd DESC, total_volume DESC
      `);

      type CatRow = {
        category: string;
        market_count: number;
        active_count: number;
        closing_today: number;
        closing_week: number;
        total_volume: string;
        total_open_interest: string;
        window_volume_usd: string;
        window_trade_count: number;
      };

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        count: rows.rows.length,
        categories: (rows.rows as CatRow[]).map((r) => ({
          category: r.category,
          marketCount: Number(r.market_count),
          activeCount: Number(r.active_count),
          closingToday: Number(r.closing_today),
          closingThisWeek: Number(r.closing_week),
          totalVolumeUsd: Number(Number(r.total_volume).toFixed(2)),
          totalOpenInterestUsd: Number(Number(r.total_open_interest).toFixed(2)),
          windowVolumeUsd: Number(Number(r.window_volume_usd).toFixed(2)),
          windowTradeCount: Number(r.window_trade_count)
        }))
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 6. GET /price-history - OHLCV price/probability time series
  .get(
    "/price-history",
    async ({ query, set }) => {
      const { marketTicker, windowHours = 24, limit = 200 } = query;
      if (!marketTicker) {
        set.status = 400;
        return { error: "ValidationError", message: "marketTicker is required" };
      }
      const since = windowSince(windowHours);

      const snaps = await db
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.marketTicker, marketTicker),
            gte(priceSnapshots.snapshotTime, since)
          )
        )
        .orderBy(asc(priceSnapshots.snapshotTime))
        .limit(limit);

      const market = await db
        .select()
        .from(markets)
        .where(eq(markets.marketTicker, marketTicker))
        .limit(1);

      if (market.length === 0 && snaps.length === 0) {
        set.status = 404;
        return { error: "NotFound", message: `Market ${marketTicker} not found` };
      }

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        count: snaps.length,
        priceHistory: snaps.map((s) => ({
          time: s.snapshotTime.toISOString(),
          yesBid: s.yesBid ? Number(s.yesBid) : null,
          yesAsk: s.yesAsk ? Number(s.yesAsk) : null,
          noBid: s.noBid ? Number(s.noBid) : null,
          noAsk: s.noAsk ? Number(s.noAsk) : null,
          yesMid:
            s.yesBid && s.yesAsk
              ? Number(((Number(s.yesBid) + Number(s.yesAsk)) / 2).toFixed(6))
              : null
        }))
      };
    },
    {
      query: t.Object({
        marketTicker: t.Optional(t.String()),
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 }))
      })
    }
  )

  // 5. POST /intelligence - Full smart money intelligence report (Conviction Map)
  .post(
    "/intelligence",
    async ({ body, set }) => {
      const { marketTicker, windowHours = 24 } = body;
      const since = windowSince(windowHours);

      const marketRows = await db
        .select()
        .from(markets)
        .where(eq(markets.marketTicker, marketTicker))
        .limit(1);

      if (marketRows.length === 0) {
        set.status = 404;
        return { error: "NotFound", message: `Market ${marketTicker} not found` };
      }
      const market = marketRows[0];

      // Orderbook depth
      const obRows = await db
        .select()
        .from(orderbookSnapshots)
        .where(eq(orderbookSnapshots.marketTicker, marketTicker))
        .orderBy(desc(orderbookSnapshots.snapshotTime))
        .limit(1);
      const ob = obRows[0];
      const orderbookDepth = ob
        ? computeOrderbookDepth(
            ob.yesBids as Record<string, number>,
            ob.noBids as Record<string, number>
          )
        : null;

      // Trade stats in window
      const tradeStats = await db.execute(sql`
        SELECT
          COUNT(*)::int AS trade_count,
          COALESCE(SUM(notional_usd_est::numeric), 0) AS total_notional,
          COALESCE(SUM(CASE WHEN taker_side = 'YES' THEN notional_usd_est::numeric ELSE 0 END), 0) AS yes_notional,
          COALESCE(SUM(CASE WHEN taker_side = 'NO'  THEN notional_usd_est::numeric ELSE 0 END), 0) AS no_notional,
          COALESCE(MAX(notional_usd_est::numeric), 0) AS largest_trade_usd,
          COUNT(CASE WHEN notional_usd_est::numeric >= ${env.LARGE_ORDER_MIN_USD} THEN 1 END)::int AS large_order_count
        FROM trade_facts
        WHERE market_ticker = ${marketTicker}
          AND created_time >= ${since}
      `);
      const ts = (tradeStats.rows as any[])[0] ?? {};
      const totalNotional = Number(ts.total_notional ?? 0);
      const yesNotional = Number(ts.yes_notional ?? 0);
      const noNotional = Number(ts.no_notional ?? 0);

      // Wallet signals
      const walletRows = await db
        .select()
        .from(walletAttributions)
        .where(
          and(
            eq(walletAttributions.marketTicker, marketTicker),
            gte(walletAttributions.attributedTime, since),
            gte(walletAttributions.attributionConfidence, "0.700")
          )
        )
        .orderBy(desc(walletAttributions.sizeUsdEst))
        .limit(50);

      const walletsByAddress = new Map<
        string,
        { totalUsd: number; side: string; count: number; confidence: number }
      >();
      for (const w of walletRows) {
        const existing = walletsByAddress.get(w.walletAddress) ?? {
          totalUsd: 0,
          side: w.side,
          count: 0,
          confidence: 0
        };
        walletsByAddress.set(w.walletAddress, {
          totalUsd: existing.totalUsd + Number(w.sizeUsdEst ?? 0),
          side: existing.side === w.side ? existing.side : "MIXED",
          count: existing.count + 1,
          confidence: Math.max(existing.confidence, Number(w.attributionConfidence))
        });
      }

      const topWallets = [...walletsByAddress.entries()]
        .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
        .slice(0, 10)
        .map(([address, stats]) => ({
          walletAddress: address,
          side: stats.side,
          totalUsd: Number(stats.totalUsd.toFixed(2)),
          tradeCount: stats.count,
          maxConfidence: Number(stats.confidence.toFixed(3))
        }));

      const insiderCount = walletRows.filter((w) => {
        const sizeUsd = Number(w.sizeUsdEst ?? 0);
        return sizeUsd >= env.TAG_MIN_ORDER_USD;
      }).length;

      // Sentiment bias from wallet flow
      const walletYesUsd = walletRows.filter((w) => w.side === "YES").reduce((a, w) => a + Number(w.sizeUsdEst ?? 0), 0);
      const walletNoUsd = walletRows.filter((w) => w.side === "NO").reduce((a, w) => a + Number(w.sizeUsdEst ?? 0), 0);
      const walletBias = walletYesUsd > walletNoUsd ? "YES" : walletNoUsd > walletYesUsd ? "NO" : "NEUTRAL";

      // Price-implied bias
      const yesMid =
        market.yesBid && market.yesAsk
          ? (Number(market.yesBid) + Number(market.yesAsk)) / 2
          : Number(market.yesBid ?? 0) || Number(market.yesAsk ?? 0);
      const priceBias = yesMid > 0.5 ? "YES" : yesMid < 0.5 ? "NO" : "NEUTRAL";

      // Dislocation check
      const dislocation = walletBias !== "NEUTRAL" && walletBias !== priceBias;

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        market: {
          title: market.title,
          subtitle: market.subtitle,
          status: market.status,
          closeTime: market.closeTime?.toISOString() ?? null,
          yesBid: market.yesBid ? Number(market.yesBid) : null,
          yesAsk: market.yesAsk ? Number(market.yesAsk) : null,
          noBid: market.noBid ? Number(market.noBid) : null,
          noAsk: market.noAsk ? Number(market.noAsk) : null,
          volume: Number(market.volume ?? 0),
          openInterest: Number(market.openInterest ?? 0),
          impliedProbabilityYes: Number(yesMid.toFixed(4)),
          priceBias
        },
        orderbookLiquidity: orderbookDepth,
        tradeFlow: {
          tradeCount: Number(ts.trade_count ?? 0),
          totalNotionalUsd: Number(totalNotional.toFixed(2)),
          yesNotionalUsd: Number(yesNotional.toFixed(2)),
          noNotionalUsd: Number(noNotional.toFixed(2)),
          largeOrderCount: Number(ts.large_order_count ?? 0),
          largestTradeUsd: Number(Number(ts.largest_trade_usd ?? 0).toFixed(2)),
          sentimentBias: yesNotional > noNotional ? "YES" : noNotional > yesNotional ? "NO" : "NEUTRAL"
        },
        walletIntelligence: {
          distinctWallets: walletsByAddress.size,
          walletBias,
          walletYesUsd: Number(walletYesUsd.toFixed(2)),
          walletNoUsd: Number(walletNoUsd.toFixed(2)),
          largeOrderWallets: insiderCount,
          topWallets,
          dislocation,
          dislocationType:
            dislocation ? `Smart money is ${walletBias} while price implies ${priceBias}` : null
        },
        conviction: {
          score: Math.min(
            100,
            Math.round(
              (Math.min(totalNotional / 10000, 1) * 30) +
                (walletsByAddress.size > 0 ? Math.min(walletsByAddress.size / 5, 1) * 40 : 0) +
                (dislocation ? 30 : 0)
            )
          ),
          band:
            dislocation
              ? "HIGH"
              : walletsByAddress.size >= 3
              ? "MEDIUM"
              : "LOW",
          notes: [
            `${walletsByAddress.size} tracked wallets in this market`,
            `Trade flow: $${totalNotional.toFixed(0)} in ${windowHours}h window`,
            dislocation ? `Signal dislocation: wallets are ${walletBias} vs price implying ${priceBias}` : "No dislocation detected"
          ]
        }
      };
    },
    {
      body: t.Object({
        marketTicker: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 7. POST /sentiment - Sentiment time series with smart money overlay (Signal Drift)
  .post(
    "/sentiment",
    async ({ body, set }) => {
      const { marketTicker, windowHours = 24, bucketHours = 1 } = body;
      const since = windowSince(windowHours);

      const marketRows = await db.select().from(markets).where(eq(markets.marketTicker, marketTicker)).limit(1);
      if (marketRows.length === 0) {
        set.status = 404;
        return { error: "NotFound", message: `Market ${marketTicker} not found` };
      }

      const bucketRows = await db.execute(sql`
        SELECT
          date_trunc('hour', created_time) +
            (EXTRACT(hour FROM created_time)::int / ${bucketHours} * ${bucketHours} || ' hours')::interval -
            EXTRACT(hour FROM date_trunc('hour', created_time))::int % ${bucketHours} * INTERVAL '1 hour'
            AS bucket,
          SUM(CASE WHEN taker_side = 'YES' THEN notional_usd_est::numeric ELSE 0 END) AS yes_notional,
          SUM(CASE WHEN taker_side = 'NO'  THEN notional_usd_est::numeric ELSE 0 END) AS no_notional,
          COUNT(*)::int AS trade_count
        FROM trade_facts
        WHERE market_ticker = ${marketTicker}
          AND created_time >= ${since}
        GROUP BY bucket
        ORDER BY bucket ASC
      `);

      // Smart money overlay from wallet attributions
      const walletBuckets = await db.execute(sql`
        SELECT
          date_trunc('hour', attributed_time) AS bucket,
          SUM(CASE WHEN side = 'YES' THEN size_usd_est::numeric ELSE 0 END) AS smart_yes,
          SUM(CASE WHEN side = 'NO'  THEN size_usd_est::numeric ELSE 0 END) AS smart_no,
          COUNT(DISTINCT wallet_address)::int AS wallet_count
        FROM wallet_attributions
        WHERE market_ticker = ${marketTicker}
          AND attributed_time >= ${since}
          AND attribution_confidence::numeric >= 0.7
        GROUP BY bucket
        ORDER BY bucket ASC
      `);

      const walletByBucket = new Map<string, { smart_yes: number; smart_no: number; wallet_count: number }>();
      for (const row of walletBuckets.rows as any[]) {
        walletByBucket.set(String(row.bucket), {
          smart_yes: Number(row.smart_yes ?? 0),
          smart_no: Number(row.smart_no ?? 0),
          wallet_count: Number(row.wallet_count ?? 0)
        });
      }

      type BucketRow = { bucket: unknown; yes_notional: string; no_notional: string; trade_count: number };

      const series = (bucketRows.rows as BucketRow[]).map((r) => {
        const bucketKey = String(r.bucket);
        const wallet = walletByBucket.get(bucketKey);
        const yes = Number(r.yes_notional ?? 0);
        const no = Number(r.no_notional ?? 0);
        return {
          time: bucketKey,
          yesNotionalUsd: Number(yes.toFixed(2)),
          noNotionalUsd: Number(no.toFixed(2)),
          tradeCount: Number(r.trade_count),
          sentiment: yes > no ? "YES" : no > yes ? "NO" : "NEUTRAL",
          smartMoney: wallet
            ? {
                smartYesUsd: Number(wallet.smart_yes.toFixed(2)),
                smartNoUsd: Number(wallet.smart_no.toFixed(2)),
                walletCount: wallet.wallet_count,
                bias: wallet.smart_yes > wallet.smart_no ? "YES" : wallet.smart_no > wallet.smart_yes ? "NO" : "NEUTRAL"
              }
            : null
        };
      });

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        bucketHours,
        count: series.length,
        series
      };
    },
    {
      body: t.Object({
        marketTicker: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 })),
        bucketHours: t.Optional(t.Number({ minimum: 1, maximum: 24 }))
      })
    }
  )

  // 8. POST /participants - Participant summary by scoring tier
  .post(
    "/participants",
    async ({ body, set }) => {
      const { marketTicker, windowHours = 24 } = body;
      const since = windowSince(windowHours);

      const marketRows = await db.select().from(markets).where(eq(markets.marketTicker, marketTicker)).limit(1);
      if (marketRows.length === 0) {
        set.status = 404;
        return { error: "NotFound", message: `Market ${marketTicker} not found` };
      }

      const attrRows = await db.execute(sql`
        SELECT
          wa.wallet_address,
          wa.side,
          SUM(wa.size_usd_est::numeric) AS total_usd,
          COUNT(*)::int AS trade_count,
          AVG(wa.attribution_confidence::numeric) AS avg_confidence,
          wp.quality_score,
          wp.hit_rate,
          wp.category_normalized
        FROM wallet_attributions wa
        LEFT JOIN wallet_profiles wp ON wp.wallet_address = wa.wallet_address
        WHERE wa.market_ticker = ${marketTicker}
          AND wa.attributed_time >= ${since}
        GROUP BY wa.wallet_address, wa.side, wp.quality_score, wp.hit_rate, wp.category_normalized
        ORDER BY total_usd DESC
        LIMIT 100
      `);

      type ParticipantRow = {
        wallet_address: string;
        side: string;
        total_usd: string;
        trade_count: number;
        avg_confidence: string;
        quality_score: string | null;
        hit_rate: string | null;
        category_normalized: string | null;
      };

      const participants = (attrRows.rows as ParticipantRow[]).map((r) => {
        const qualityScore = r.quality_score ? Number(r.quality_score) : null;
        const tier =
          qualityScore === null
            ? "unscored"
            : qualityScore >= 0.75
            ? "elite"
            : qualityScore >= 0.5
            ? "strong"
            : qualityScore >= 0.25
            ? "average"
            : "weak";
        return {
          walletAddress: r.wallet_address,
          side: r.side,
          totalUsd: Number(Number(r.total_usd).toFixed(2)),
          tradeCount: Number(r.trade_count),
          avgConfidence: Number(Number(r.avg_confidence).toFixed(3)),
          qualityScore,
          hitRate: r.hit_rate ? Number(r.hit_rate) : null,
          category: r.category_normalized,
          tier
        };
      });

      const tierCounts = participants.reduce(
        (acc, p) => {
          acc[p.tier] = (acc[p.tier] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        totalParticipants: participants.length,
        tierCounts,
        participants
      };
    },
    {
      body: t.Object({
        marketTicker: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 9. POST /insiders - Insider pattern detection (Shadow Watch)
  .post(
    "/insiders",
    async ({ body, set }) => {
      const { marketTicker, windowHours = 24 } = body;
      const since = windowSince(windowHours);

      const marketRows = await db.select().from(markets).where(eq(markets.marketTicker, marketTicker)).limit(1);
      if (marketRows.length === 0) {
        set.status = 404;
        return { error: "NotFound", message: `Market ${marketTicker} not found` };
      }

      // Insider signals: new wallets (< INSIDER_MAX_ACCOUNT_AGE_DAYS) with large orders
      const insiderRows = await db.execute(sql`
        WITH wallet_first_seen AS (
          SELECT wallet_address, MIN(attributed_time) AS first_seen_at
          FROM wallet_attributions
          WHERE source IN ('helius_enhanced', 'rpc_replay')
          GROUP BY wallet_address
        ),
        wallet_stats AS (
          SELECT
            wa.wallet_address,
            wa.side,
            SUM(wa.size_usd_est::numeric) AS total_usd,
            COUNT(*)::int AS order_count,
            MAX(wa.attribution_confidence::numeric) AS max_confidence,
            wfs.first_seen_at,
            EXTRACT(EPOCH FROM (NOW() - wfs.first_seen_at)) / 86400 AS wallet_age_days
          FROM wallet_attributions wa
          JOIN wallet_first_seen wfs ON wfs.wallet_address = wa.wallet_address
          WHERE wa.market_ticker = ${marketTicker}
            AND wa.attributed_time >= ${since}
            AND wa.size_usd_est::numeric >= ${env.LARGE_ORDER_MIN_USD}
            AND wa.attribution_confidence::numeric >= 0.7
            AND wa.source IN ('helius_enhanced', 'rpc_replay')
          GROUP BY wa.wallet_address, wa.side, wfs.first_seen_at
        )
        SELECT *,
          CASE
            WHEN wallet_age_days <= ${env.INSIDER_MAX_ACCOUNT_AGE_DAYS} AND total_usd >= ${env.TAG_MIN_ORDER_USD} THEN 'INSIDER'
            WHEN total_usd >= ${env.TAG_MIN_ORDER_USD} THEN 'LARGE_PLAYER'
            ELSE 'TRACKED'
          END AS signal_tag
        FROM wallet_stats
        ORDER BY total_usd DESC
        LIMIT 50
      `);

      type InsiderRow = {
        wallet_address: string;
        side: string;
        total_usd: string;
        order_count: number;
        max_confidence: string;
        first_seen_at: string;
        wallet_age_days: string;
        signal_tag: string;
      };

      const insiders = (insiderRows.rows as InsiderRow[]).map((r) => {
        const ageDays = Math.round(Number(r.wallet_age_days ?? 0));
        const totalUsd = Number(r.total_usd ?? 0);
        const signals: string[] = [];

        if (r.signal_tag === "INSIDER") {
          signals.push(`New wallet (~${ageDays}d old) with $${totalUsd.toFixed(0)} large orders`);
          signals.push(`${r.order_count} orders placed in this market`);
          if (Number(r.max_confidence) >= 0.9) {
            signals.push("High attribution confidence (>90%)");
          }
        }

        return {
          walletAddress: r.wallet_address,
          signalTag: r.signal_tag,
          side: r.side,
          totalUsd: Number(totalUsd.toFixed(2)),
          orderCount: Number(r.order_count),
          maxConfidence: Number(Number(r.max_confidence).toFixed(3)),
          walletAgeDays: ageDays,
          firstSeenAt: r.first_seen_at,
          behaviorSignals: signals,
          insiderScore: Math.min(
            100,
            Math.round(
              (r.signal_tag === "INSIDER" ? 60 : 20) +
                Math.min(totalUsd / 1000, 30) +
                (Number(r.max_confidence) >= 0.9 ? 10 : 0)
            )
          )
        };
      });

      const trueInsiders = insiders.filter((i) => i.signalTag === "INSIDER");

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        insiderCount: trueInsiders.length,
        largePlayerCount: insiders.filter((i) => i.signalTag === "LARGE_PLAYER").length,
        dominantSide:
          trueInsiders.length > 0
            ? trueInsiders.filter((i) => i.side === "YES").length >
              trueInsiders.filter((i) => i.side === "NO").length
              ? "YES"
              : "NO"
            : null,
        insiders
      };
    },
    {
      body: t.Object({
        marketTicker: t.String(),
        windowHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 10. GET /trades - Chronological trade feed for a market
  .get(
    "/trades",
    async ({ query, set }) => {
      const { marketTicker, windowHours = 24, limit = 100 } = query;
      if (!marketTicker) {
        set.status = 400;
        return { error: "ValidationError", message: "marketTicker is required" };
      }
      const since = windowSince(windowHours);

      const trades = await db
        .select()
        .from(tradeFacts)
        .where(
          and(
            eq(tradeFacts.marketTicker, marketTicker),
            gte(tradeFacts.createdTime, since)
          )
        )
        .orderBy(desc(tradeFacts.createdTime))
        .limit(limit);

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        count: trades.length,
        trades: trades.map((t) => ({
          tradeId: t.tradeId,
          time: t.createdTime.toISOString(),
          takerSide: t.takerSide,
          count: t.count,
          yesPriceDollars: t.yesPriceDollars ? Number(t.yesPriceDollars) : null,
          noPriceDollars: t.noPriceDollars ? Number(t.noPriceDollars) : null,
          notionalUsdEst: t.notionalUsdEst ? Number(t.notionalUsdEst) : null,
          isLargeOrder: Number(t.notionalUsdEst ?? 0) >= env.LARGE_ORDER_MIN_USD
        }))
      };
    },
    {
      query: t.Object({
        marketTicker: t.Optional(t.String()),
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 }))
      })
    }
  )

  // 11. GET /similar - Related markets by wallet overlap
  .get(
    "/similar",
    async ({ query, set }) => {
      const { marketTicker, windowHours = 168, limit = 10 } = query;
      if (!marketTicker) {
        set.status = 400;
        return { error: "ValidationError", message: "marketTicker is required" };
      }
      const since = windowSince(windowHours);

      const similarRows = await db.execute(sql`
        SELECT
          wa2.market_ticker,
          COUNT(DISTINCT wa2.wallet_address)::int AS shared_wallets,
          SUM(wa2.size_usd_est::numeric) AS overlap_notional
        FROM wallet_attributions wa1
        JOIN wallet_attributions wa2
          ON wa1.wallet_address = wa2.wallet_address
          AND wa2.market_ticker != ${marketTicker}
        WHERE wa1.market_ticker = ${marketTicker}
          AND wa1.attributed_time >= ${since}
          AND wa2.attributed_time >= ${since}
        GROUP BY wa2.market_ticker
        ORDER BY shared_wallets DESC, overlap_notional DESC NULLS LAST
        LIMIT ${limit}
      `);

      type SimRow = { market_ticker: string; shared_wallets: number; overlap_notional: string };
      const tickers = (similarRows.rows as SimRow[]).map((r) => r.market_ticker).filter(Boolean);
      const marketRows =
        tickers.length > 0
          ? await db.select().from(markets).where(inArray(markets.marketTicker, tickers))
          : [];
      const byTicker = new Map(marketRows.map((m) => [m.marketTicker, m]));

      return {
        generatedAt: new Date().toISOString(),
        marketTicker,
        windowHours,
        count: (similarRows.rows as SimRow[]).length,
        similar: (similarRows.rows as SimRow[]).map((r) => {
          const m = byTicker.get(r.market_ticker);
          return {
            marketTicker: r.market_ticker,
            title: m?.title ?? r.market_ticker,
            status: m?.status ?? null,
            closeTime: m?.closeTime?.toISOString() ?? null,
            sharedWallets: Number(r.shared_wallets),
            overlapNotionalUsd: Number(Number(r.overlap_notional ?? 0).toFixed(2))
          };
        })
      };
    },
    {
      query: t.Object({
        marketTicker: t.Optional(t.String()),
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 }))
      })
    }
  )

  // 12. GET /opportunities - Edge Window: markets where smart money disagrees with price
  .get(
    "/opportunities",
    async ({ query }) => {
      const { windowHours = 24, limit = 20 } = query;
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        WITH wallet_signals AS (
          SELECT
            market_ticker,
            SUM(CASE WHEN side = 'YES' THEN size_usd_est::numeric ELSE 0 END) AS wallet_yes_usd,
            SUM(CASE WHEN side = 'NO'  THEN size_usd_est::numeric ELSE 0 END) AS wallet_no_usd,
            COUNT(DISTINCT wallet_address)::int AS wallet_count
          FROM wallet_attributions
          WHERE attributed_time >= ${since}
            AND attribution_confidence::numeric >= 0.7
            AND size_usd_est::numeric >= ${env.LARGE_ORDER_MIN_USD}
          GROUP BY market_ticker
          HAVING SUM(size_usd_est::numeric) >= ${env.TAG_MIN_ORDER_USD}
        )
        SELECT
          m.market_ticker,
          m.title,
          m.status,
          m.close_time,
          m.yes_bid,
          m.yes_ask,
          m.no_bid,
          m.no_ask,
          ws.wallet_yes_usd,
          ws.wallet_no_usd,
          ws.wallet_count,
          CASE
            WHEN ws.wallet_yes_usd > ws.wallet_no_usd THEN 'YES'
            WHEN ws.wallet_no_usd > ws.wallet_yes_usd THEN 'NO'
            ELSE 'NEUTRAL'
          END AS wallet_bias,
          (m.yes_bid::numeric + m.yes_ask::numeric) / 2 AS yes_mid
        FROM wallet_signals ws
        JOIN markets m ON m.market_ticker = ws.market_ticker
        WHERE m.yes_bid IS NOT NULL AND m.yes_ask IS NOT NULL
          AND m.status = 'active'
        ORDER BY (ws.wallet_yes_usd + ws.wallet_no_usd) DESC NULLS LAST
        LIMIT ${limit}
      `);

      type OppRow = {
        market_ticker: string;
        title: string;
        status: string;
        close_time: string | null;
        yes_bid: string | null;
        yes_ask: string | null;
        no_bid: string | null;
        no_ask: string | null;
        wallet_yes_usd: string;
        wallet_no_usd: string;
        wallet_count: number;
        wallet_bias: string;
        yes_mid: string;
      };

      const opportunities = (rows.rows as OppRow[]).map((r) => {
        const yesMid = Number(r.yes_mid ?? 0);
        const priceBias = yesMid > 0.5 ? "YES" : yesMid < 0.5 ? "NO" : "NEUTRAL";
        const isDislocation = r.wallet_bias !== "NEUTRAL" && r.wallet_bias !== priceBias;
        const walletYes = Number(r.wallet_yes_usd ?? 0);
        const walletNo = Number(r.wallet_no_usd ?? 0);
        return {
          marketTicker: r.market_ticker,
          title: r.title,
          status: r.status,
          closeTime: r.close_time,
          yesBid: r.yes_bid ? Number(r.yes_bid) : null,
          yesAsk: r.yes_ask ? Number(r.yes_ask) : null,
          noBid: r.no_bid ? Number(r.no_bid) : null,
          noAsk: r.no_ask ? Number(r.no_ask) : null,
          impliedProbabilityYes: Number(yesMid.toFixed(4)),
          priceBias,
          walletBias: r.wallet_bias,
          walletYesUsd: Number(walletYes.toFixed(2)),
          walletNoUsd: Number(walletNo.toFixed(2)),
          walletCount: Number(r.wallet_count),
          isDislocation,
          opportunityNote: isDislocation
            ? `Smart money is ${r.wallet_bias} while price implies ${priceBias} (${(yesMid * 100).toFixed(1)}%)`
            : "No dislocation detected"
        };
      }).filter((o) => o.isDislocation);

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        count: opportunities.length,
        opportunities
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
      })
    }
  )

  // 13. GET /high-conviction - High-conviction smart money bets (Conviction Map)
  .get(
    "/high-conviction",
    async ({ query }) => {
      const { windowHours = 24, limit = 20, minWallets = 2 } = query;
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        WITH wallet_flow AS (
          SELECT
            market_ticker,
            SUM(CASE WHEN side = 'YES' THEN size_usd_est::numeric ELSE 0 END) AS yes_usd,
            SUM(CASE WHEN side = 'NO'  THEN size_usd_est::numeric ELSE 0 END) AS no_usd,
            COUNT(DISTINCT wallet_address)::int AS wallet_count,
            SUM(size_usd_est::numeric) AS total_usd,
            AVG(attribution_confidence::numeric) AS avg_confidence
          FROM wallet_attributions
          WHERE attributed_time >= ${since}
            AND attribution_confidence::numeric >= 0.7
            AND size_usd_est::numeric >= ${env.LARGE_ORDER_MIN_USD}
          GROUP BY market_ticker
          HAVING COUNT(DISTINCT wallet_address) >= ${minWallets}
        )
        SELECT
          m.market_ticker, m.title, m.subtitle, m.status, m.close_time,
          m.yes_bid, m.yes_ask, m.no_bid, m.no_ask,
          m.volume, m.open_interest,
          wf.yes_usd, wf.no_usd, wf.wallet_count, wf.total_usd, wf.avg_confidence,
          CASE
            WHEN wf.yes_usd > wf.no_usd THEN 'YES'
            WHEN wf.no_usd > wf.yes_usd THEN 'NO'
            ELSE 'NEUTRAL'
          END AS dominant_side,
          ABS(wf.yes_usd - wf.no_usd) / NULLIF(wf.yes_usd + wf.no_usd, 0) AS conviction_ratio
        FROM wallet_flow wf
        JOIN markets m ON m.market_ticker = wf.market_ticker
        WHERE m.status = 'active'
        ORDER BY conviction_ratio DESC NULLS LAST, total_usd DESC NULLS LAST
        LIMIT ${limit}
      `);

      type ConvRow = {
        market_ticker: string;
        title: string;
        subtitle: string;
        status: string;
        close_time: string | null;
        yes_bid: string | null;
        yes_ask: string | null;
        no_bid: string | null;
        no_ask: string | null;
        volume: string;
        open_interest: string;
        yes_usd: string;
        no_usd: string;
        wallet_count: number;
        total_usd: string;
        avg_confidence: string;
        dominant_side: string;
        conviction_ratio: string;
      };

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        minWallets,
        count: (rows.rows as ConvRow[]).length,
        markets: (rows.rows as ConvRow[]).map((r) => ({
          marketTicker: r.market_ticker,
          title: r.title,
          subtitle: r.subtitle,
          status: r.status,
          closeTime: r.close_time,
          yesBid: r.yes_bid ? Number(r.yes_bid) : null,
          yesAsk: r.yes_ask ? Number(r.yes_ask) : null,
          noBid: r.no_bid ? Number(r.no_bid) : null,
          noAsk: r.no_ask ? Number(r.no_ask) : null,
          smartFlow: {
            dominantSide: r.dominant_side,
            yesUsd: Number(Number(r.yes_usd).toFixed(2)),
            noUsd: Number(Number(r.no_usd).toFixed(2)),
            totalUsd: Number(Number(r.total_usd).toFixed(2)),
            walletCount: Number(r.wallet_count),
            avgConfidence: Number(Number(r.avg_confidence).toFixed(3)),
            convictionRatio: Number(Number(r.conviction_ratio ?? 0).toFixed(4))
          }
        }))
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        minWallets: t.Optional(t.Numeric({ minimum: 1, maximum: 50 }))
      })
    }
  )

  // 14. GET /capital-flow - Capital flow by category (sector rotation)
  .get(
    "/capital-flow",
    async ({ query }) => {
      const { windowHours = 24 } = query;
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        SELECT
          e.series_ticker AS category,
          SUM(tf.notional_usd_est::numeric) AS total_notional,
          SUM(CASE WHEN tf.taker_side = 'YES' THEN tf.notional_usd_est::numeric ELSE 0 END) AS yes_notional,
          SUM(CASE WHEN tf.taker_side = 'NO'  THEN tf.notional_usd_est::numeric ELSE 0 END) AS no_notional,
          COUNT(*)::int AS trade_count,
          COUNT(DISTINCT tf.market_ticker)::int AS active_markets
        FROM trade_facts tf
        JOIN markets m ON m.market_ticker = tf.market_ticker
        JOIN events e ON e.event_ticker = m.event_ticker
        WHERE tf.created_time >= ${since}
        GROUP BY e.series_ticker
        ORDER BY total_notional DESC NULLS LAST
      `);

      type FlowRow = {
        category: string;
        total_notional: string;
        yes_notional: string;
        no_notional: string;
        trade_count: number;
        active_markets: number;
      };

      const totalFlow = (rows.rows as FlowRow[]).reduce((a, r) => a + Number(r.total_notional ?? 0), 0);

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        totalFlowUsd: Number(totalFlow.toFixed(2)),
        count: rows.rows.length,
        categoryFlow: (rows.rows as FlowRow[]).map((r) => {
          const total = Number(r.total_notional ?? 0);
          const yes = Number(r.yes_notional ?? 0);
          const no = Number(r.no_notional ?? 0);
          return {
            category: r.category,
            totalNotionalUsd: Number(total.toFixed(2)),
            yesNotionalUsd: Number(yes.toFixed(2)),
            noNotionalUsd: Number(no.toFixed(2)),
            tradeCount: Number(r.trade_count),
            activeMarkets: Number(r.active_markets),
            flowShare: totalFlow > 0 ? Number((total / totalFlow).toFixed(4)) : 0,
            bias: yes > no ? "YES" : no > yes ? "NO" : "NEUTRAL"
          };
        })
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 }))
      })
    }
  )

  // 16. GET /volume-heatmap - Volume distribution across categories/hours/days
  .get(
    "/volume-heatmap",
    async ({ query }) => {
      const { windowHours = 168 } = query; // default 7 days
      const since = windowSince(windowHours);

      const hourRows = await db.execute(sql`
        SELECT
          EXTRACT(HOUR FROM created_time)::int AS hour_of_day,
          EXTRACT(DOW FROM created_time)::int AS day_of_week,
          SUM(notional_usd_est::numeric) AS total_notional,
          COUNT(*)::int AS trade_count
        FROM trade_facts
        WHERE created_time >= ${since}
        GROUP BY hour_of_day, day_of_week
        ORDER BY day_of_week, hour_of_day
      `);

      const categoryRows = await db.execute(sql`
        SELECT
          e.series_ticker AS category,
          EXTRACT(HOUR FROM tf.created_time)::int AS hour_of_day,
          SUM(tf.notional_usd_est::numeric) AS total_notional,
          COUNT(*)::int AS trade_count
        FROM trade_facts tf
        JOIN markets m ON m.market_ticker = tf.market_ticker
        JOIN events e ON e.event_ticker = m.event_ticker
        WHERE tf.created_time >= ${since}
        GROUP BY e.series_ticker, hour_of_day
        ORDER BY e.series_ticker, hour_of_day
      `);

      type HourRow = { hour_of_day: number; day_of_week: number; total_notional: string; trade_count: number };
      type CatHourRow = { category: string; hour_of_day: number; total_notional: string; trade_count: number };
      const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        hourlyHeatmap: (hourRows.rows as HourRow[]).map((r) => ({
          hourOfDay: Number(r.hour_of_day),
          dayOfWeek: Number(r.day_of_week),
          dayLabel: DOW_LABELS[Number(r.day_of_week)] ?? "?",
          totalNotionalUsd: Number(Number(r.total_notional ?? 0).toFixed(2)),
          tradeCount: Number(r.trade_count)
        })),
        categoryHeatmap: (categoryRows.rows as CatHourRow[]).map((r) => ({
          category: r.category,
          hourOfDay: Number(r.hour_of_day),
          totalNotionalUsd: Number(Number(r.total_notional ?? 0).toFixed(2)),
          tradeCount: Number(r.trade_count)
        }))
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 24, maximum: 8760 }))
      })
    }
  )

  // 24. GET /resolutions - Resolved markets with smart money accuracy
  .get(
    "/resolutions",
    async ({ query }) => {
      const { limit = 50, windowHours = 720 } = query; // default 30 days
      const since = windowSince(windowHours);

      const resolvedMarkets = await db
        .select()
        .from(markets)
        .where(
          and(
            eq(markets.status, "determined"),
            gte(markets.lastSeenAt, since)
          )
        )
        .orderBy(desc(markets.lastSeenAt))
        .limit(limit);

      if (resolvedMarkets.length === 0) {
        return {
          generatedAt: new Date().toISOString(),
          windowHours,
          count: 0,
          resolutions: []
        };
      }

      const tickers = resolvedMarkets.map((m) => m.marketTicker);

      // Get wallet accuracy on resolved markets
      const walletAccuracy = await db.execute(sql`
        SELECT
          wa.market_ticker,
          wa.side,
          COUNT(DISTINCT wa.wallet_address)::int AS wallet_count,
          SUM(wa.size_usd_est::numeric) AS total_usd
        FROM wallet_attributions wa
        WHERE wa.market_ticker = ANY(${tickers})
          AND wa.attribution_confidence::numeric >= 0.7
        GROUP BY wa.market_ticker, wa.side
      `);

      type AccRow = { market_ticker: string; side: string; wallet_count: number; total_usd: string };
      const walletMap = new Map<string, { YES: { count: number; usd: number }; NO: { count: number; usd: number } }>();
      for (const row of walletAccuracy.rows as AccRow[]) {
        const existing = walletMap.get(row.market_ticker) ?? {
          YES: { count: 0, usd: 0 },
          NO: { count: 0, usd: 0 }
        };
        if (row.side === "YES") {
          existing.YES = { count: Number(row.wallet_count), usd: Number(row.total_usd ?? 0) };
        } else if (row.side === "NO") {
          existing.NO = { count: Number(row.wallet_count), usd: Number(row.total_usd ?? 0) };
        }
        walletMap.set(row.market_ticker, existing);
      }

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        count: resolvedMarkets.length,
        resolutions: resolvedMarkets.map((m) => {
          const wallet = walletMap.get(m.marketTicker);
          const result = m.result;
          const walletBias = wallet
            ? wallet.YES.usd > wallet.NO.usd
              ? "YES"
              : wallet.NO.usd > wallet.YES.usd
              ? "NO"
              : "NEUTRAL"
            : null;
          const walletWasCorrect =
            walletBias && result ? walletBias === result.toUpperCase() : null;

          return {
            marketTicker: m.marketTicker,
            title: m.title,
            result,
            resolvedAt: m.lastSeenAt?.toISOString() ?? null,
            walletData: wallet
              ? {
                  walletBias,
                  yesWallets: wallet.YES.count,
                  noWallets: wallet.NO.count,
                  yesUsd: Number(wallet.YES.usd.toFixed(2)),
                  noUsd: Number(wallet.NO.usd.toFixed(2)),
                  walletWasCorrect
                }
              : null
          };
        })
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        windowHours: t.Optional(t.Numeric({ minimum: 24, maximum: 87600 }))
      })
    }
  )

  // 26. GET /dumb-money - Low-score trader positions (Retail Pressure / contrarian indicator)
  .get(
    "/dumb-money",
    async ({ query }) => {
      const { windowHours = 24, limit = 20 } = query;
      const since = windowSince(windowHours);

      const rows = await db.execute(sql`
        WITH low_quality_wallets AS (
          SELECT wallet_address
          FROM wallet_profiles
          WHERE quality_score::numeric < 0.35
        ),
        dumb_positions AS (
          SELECT
            wa.market_ticker,
            wa.side,
            SUM(wa.size_usd_est::numeric) AS total_usd,
            COUNT(DISTINCT wa.wallet_address)::int AS wallet_count
          FROM wallet_attributions wa
          JOIN low_quality_wallets lqw ON lqw.wallet_address = wa.wallet_address
          WHERE wa.attributed_time >= ${since}
          GROUP BY wa.market_ticker, wa.side
        )
        SELECT
          m.market_ticker, m.title, m.status, m.close_time,
          m.yes_bid, m.yes_ask, m.no_bid, m.no_ask,
          dp.side AS dumb_side,
          dp.total_usd AS dumb_usd,
          dp.wallet_count
        FROM dumb_positions dp
        JOIN markets m ON m.market_ticker = dp.market_ticker
        WHERE m.status = 'active'
        ORDER BY dp.total_usd DESC NULLS LAST
        LIMIT ${limit}
      `);

      type DumbRow = {
        market_ticker: string;
        title: string;
        status: string;
        close_time: string | null;
        yes_bid: string | null;
        yes_ask: string | null;
        no_bid: string | null;
        no_ask: string | null;
        dumb_side: string;
        dumb_usd: string;
        wallet_count: number;
      };

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        note: "Low-quality wallet positions can serve as contrarian indicators",
        count: (rows.rows as DumbRow[]).length,
        positions: (rows.rows as DumbRow[]).map((r) => {
          const yesMid =
            r.yes_bid && r.yes_ask ? (Number(r.yes_bid) + Number(r.yes_ask)) / 2 : null;
          const contrarian = r.dumb_side === "YES" ? "NO" : "YES";
          return {
            marketTicker: r.market_ticker,
            title: r.title,
            status: r.status,
            closeTime: r.close_time,
            yesBid: r.yes_bid ? Number(r.yes_bid) : null,
            yesAsk: r.yes_ask ? Number(r.yes_ask) : null,
            noBid: r.no_bid ? Number(r.no_bid) : null,
            noAsk: r.no_ask ? Number(r.no_ask) : null,
            impliedProbabilityYes: yesMid ? Number(yesMid.toFixed(4)) : null,
            retailFlow: {
              side: r.dumb_side,
              totalUsd: Number(Number(r.dumb_usd).toFixed(2)),
              walletCount: Number(r.wallet_count),
              contrarianSide: contrarian,
              contrarianNote: `Retail is ${r.dumb_side} - consider ${contrarian} as contrarian play`
            }
          };
        })
      };
    },
    {
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 8760 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
      })
    }
  );
