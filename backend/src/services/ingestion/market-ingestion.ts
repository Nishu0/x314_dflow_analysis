import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import { logger } from "../../lib/pino";
import {
  events,
  marketAccounts,
  markets,
  orderbookSnapshots,
  priceSnapshots,
  tradeFacts
} from "../../db/schema";
import type { DflowMarket, DflowTrade } from "../../lib/dflow-client";

type PersistedMarketWindow = {
  market: DflowMarket;
  trades: typeof tradeFacts.$inferInsert[];
  latestOrderbook: typeof orderbookSnapshots.$inferInsert | null;
};

function toMarketStatus(status: string | undefined): "initialized" | "active" | "inactive" | "closed" | "determined" {
  if (status === "initialized") {
    return "initialized";
  }

  if (status === "inactive") {
    return "inactive";
  }

  if (status === "closed") {
    return "closed";
  }

  if (status === "determined") {
    return "determined";
  }

  return "active";
}

function buildMarketRow(market: DflowMarket): typeof markets.$inferInsert {
  const now = new Date();
  return {
    marketTicker: market.marketTicker,
    eventTicker: market.eventTicker,
    marketType: "binary",
    title: market.title ?? market.marketTicker,
    subtitle: market.subtitle ?? market.marketTicker,
    yesSubTitle: "Yes",
    noSubTitle: "No",
    openTime: now,
    closeTime: market.closeTime ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
    expirationTime: market.closeTime ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
    status: toMarketStatus(market.status),
    result: null,
    volume: String(market.volume24h ?? 0),
    openInterest: String(market.openInterest ?? 0),
    canCloseEarly: false,
    earlyCloseCondition: null,
    rulesPrimary: "Refer to dFlow market rules",
    rulesSecondary: null,
    yesBid: market.yesBid ? String(market.yesBid) : null,
    yesAsk: market.yesAsk ? String(market.yesAsk) : null,
    noBid: market.noBid ? String(market.noBid) : null,
    noAsk: market.noAsk ? String(market.noAsk) : null,
    lastSeenAt: now,
    updatedAt: now
  };
}

async function upsertEventsFromMarkets(marketRows: DflowMarket[]): Promise<void> {
  const now = new Date();
  const uniqueEventTickers = [...new Set(marketRows.map((row) => row.eventTicker))];

  for (const eventTicker of uniqueEventTickers) {
    await db
      .insert(events)
      .values({
        eventTicker,
        seriesTicker: eventTicker.split("-")[0] ?? "GEN",
        title: eventTicker,
        subtitle: "Auto-ingested event",
        competition: null,
        competitionScope: null,
        imageUrl: null,
        liquidity: null,
        openInterest: null,
        volume: null,
        volume24h: null,
        strikeDate: null,
        strikePeriod: null,
        status: "active",
        lastSeenAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: events.eventTicker,
        set: {
          lastSeenAt: now,
          updatedAt: now
        }
      });
  }
}

async function upsertMarkets(rows: DflowMarket[]): Promise<void> {
  for (const market of rows) {
    const row = buildMarketRow(market);
    await db
      .insert(markets)
      .values(row)
      .onConflictDoUpdate({
        target: markets.marketTicker,
        set: {
          title: row.title,
          subtitle: row.subtitle,
          status: row.status,
          closeTime: row.closeTime,
          expirationTime: row.expirationTime,
          volume: row.volume,
          openInterest: row.openInterest,
          yesBid: row.yesBid,
          yesAsk: row.yesAsk,
          noBid: row.noBid,
          noAsk: row.noAsk,
          lastSeenAt: row.lastSeenAt,
          updatedAt: row.updatedAt
        }
      });
  }
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function upsertMarketAccountsFromMarkets(rows: DflowMarket[]): Promise<void> {
  let upserted = 0;
  for (const market of rows) {
    const raw = market.raw;
    const accounts = raw && typeof raw === "object" && "accounts" in raw
      ? (raw as { accounts?: Record<string, unknown> }).accounts
      : undefined;

    if (!accounts || typeof accounts !== "object") {
      continue;
    }

    for (const [quoteMint, accountValue] of Object.entries(accounts)) {
      if (!accountValue || typeof accountValue !== "object") {
        continue;
      }

      const account = accountValue as Record<string, unknown>;
      const marketLedger = toStringOrNull(account.marketLedger);
      const yesMint = toStringOrNull(account.yesMint);
      const noMint = toStringOrNull(account.noMint);

      if (!marketLedger || !yesMint || !noMint) {
        continue;
      }

      await db
        .insert(marketAccounts)
        .values({
          marketTicker: market.marketTicker,
          quoteMint,
          marketLedger,
          yesMint,
          noMint,
          isInitialized: toBoolean(account.isInitialized),
          redemptionStatus: toStringOrNull(account.redemptionStatus),
          scalarOutcomePct: toNumberOrNull(account.scalarOutcomePct),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [marketAccounts.marketTicker, marketAccounts.quoteMint],
          set: {
            marketLedger,
            yesMint,
            noMint,
            isInitialized: toBoolean(account.isInitialized),
            redemptionStatus: toStringOrNull(account.redemptionStatus),
            scalarOutcomePct: toNumberOrNull(account.scalarOutcomePct),
            updatedAt: new Date()
          }
        });
      upserted += 1;
    }
  }

  logger.info({ marketAccountsUpserted: upserted }, "ingestion market accounts upserted");
}

export async function ingestMarketWindow(params: {
  markets: DflowMarket[];
  globalTradesByMarket: Map<string, DflowTrade[]>;
  runAt: Date;
}): Promise<PersistedMarketWindow[]> {
  logger.info({ markets: params.markets.length }, "ingestion start");
  await upsertEventsFromMarkets(params.markets);
  await upsertMarkets(params.markets);
  await upsertMarketAccountsFromMarkets(params.markets);

  const persisted: PersistedMarketWindow[] = [];

  for (const market of params.markets) {
    const trades = params.globalTradesByMarket.get(market.marketTicker) ?? [];

    const tradeRows: typeof tradeFacts.$inferInsert[] = trades.map((trade) => ({
      tradeId: trade.tradeId,
      marketTicker: market.marketTicker,
      createdTime: trade.createdTime,
      takerSide: trade.takerSide,
      price: Math.round(trade.yesPriceDollars * 10000),
      count: Math.round(trade.count),
      yesPrice: Math.round(trade.yesPriceDollars * 10000),
      noPrice: Math.round(trade.noPriceDollars * 10000),
      yesPriceDollars: trade.yesPriceDollars.toFixed(6),
      noPriceDollars: trade.noPriceDollars.toFixed(6),
      notionalUsdEst: trade.notionalUsdEst.toFixed(8),
      ingestionSource: "dflow_rest"
    }));

    for (const tradeRow of tradeRows) {
      await db.insert(tradeFacts).values(tradeRow).onConflictDoNothing({ target: tradeFacts.tradeId });
    }

    logger.debug({ marketTicker: market.marketTicker, trades: tradeRows.length }, "ingestion trades persisted");

    await db
      .insert(orderbookSnapshots)
      .values({
        marketTicker: market.marketTicker,
        snapshotTime: params.runAt,
        sequence: null,
        yesBids: {},
        noBids: {},
        ingestionSource: "dflow_rest"
      })
      .onConflictDoNothing({
        target: [orderbookSnapshots.marketTicker, orderbookSnapshots.snapshotTime]
      });

    logger.debug({ marketTicker: market.marketTicker }, "ingestion orderbook persisted");

    await db
      .insert(priceSnapshots)
      .values({
        marketTicker: market.marketTicker,
        snapshotTime: params.runAt,
        yesBid: market.yesBid ? market.yesBid.toFixed(6) : null,
        yesAsk: market.yesAsk ? market.yesAsk.toFixed(6) : null,
        noBid: market.noBid ? market.noBid.toFixed(6) : null,
        noAsk: market.noAsk ? market.noAsk.toFixed(6) : null,
        ingestionSource: "dflow_rest"
      })
      .onConflictDoNothing({
        target: [priceSnapshots.marketTicker, priceSnapshots.snapshotTime]
      });

    logger.debug({ marketTicker: market.marketTicker }, "ingestion prices persisted");

    persisted.push({
      market,
      trades: tradeRows,
      latestOrderbook: {
        marketTicker: market.marketTicker,
        snapshotTime: params.runAt,
        sequence: null,
        yesBids: {},
        noBids: {},
        ingestionSource: "dflow_rest"
      }
    });
  }

  logger.info({ markets: persisted.length }, "ingestion completed");
  return persisted;
}

export async function loadPersistedTradesForMarket(params: {
  marketTicker: string;
  windowStart: Date;
}): Promise<(typeof tradeFacts.$inferSelect)[]> {
  return db
    .select()
    .from(tradeFacts)
    .where(and(eq(tradeFacts.marketTicker, params.marketTicker), gte(tradeFacts.createdTime, params.windowStart)))
    .orderBy(desc(tradeFacts.createdTime));
}

export async function loadLatestOrderbookForMarket(marketTicker: string): Promise<(typeof orderbookSnapshots.$inferSelect) | null> {
  const rows = await db
    .select()
    .from(orderbookSnapshots)
    .where(eq(orderbookSnapshots.marketTicker, marketTicker))
    .orderBy(desc(orderbookSnapshots.snapshotTime))
    .limit(1);

  return rows[0] ?? null;
}
