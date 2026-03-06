import { desc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { env } from "../config";
import { db } from "../db/client";
import { markets } from "../db/schema";
import { listTaggedHoldersForMarket, listTaggedWalletSignals } from "../services/wallet/holder-signals";

type AggregatedMarketSignal = {
  signalType: "INSIDER" | "WHALE";
  confidencePercent: number;
  reason: string;
  walletAddress: string;
  signalWeight: number;
};

function toSignalReason(params: {
  tag: "INSIDER" | "WHALE";
  walletAgeDays: number;
  largeOrdersUsdTotal: number;
  walletBalanceUsd: number | null;
}): string {
  if (params.tag === "INSIDER") {
    return `New wallet (~${params.walletAgeDays}d old) placed $${params.largeOrdersUsdTotal.toFixed(2)} large orders`;
  }

  return `Whale wallet (~$${(params.walletBalanceUsd ?? 0).toFixed(2)}) placed $${params.largeOrdersUsdTotal.toFixed(2)} large orders`;
}

export const marketRoutes = new Elysia({ prefix: "/markets" })
  .get(
    "/",
    async ({ query }) => {
      const limit = query.limit;
      const windowHours = query.windowHours ?? env.ANALYSIS_WINDOW_HOURS;
      const taggedWallets = await listTaggedWalletSignals({
        windowHours
      });

      const marketSignalMap = new Map<string, AggregatedMarketSignal>();
      for (const wallet of taggedWallets) {
        for (const marketTicker of wallet.relatedMarketTickers) {
          const signalWeight = wallet.largeOrdersUsdTotal;
          const existing = marketSignalMap.get(marketTicker);
          if (!existing || signalWeight > existing.signalWeight) {
            marketSignalMap.set(marketTicker, {
              signalType: wallet.tag,
              confidencePercent: Math.min(100, Math.round(wallet.attributionConfidence * 100)),
              reason: toSignalReason({
                tag: wallet.tag,
                walletAgeDays: wallet.walletAgeDays,
                largeOrdersUsdTotal: wallet.largeOrdersUsdTotal,
                walletBalanceUsd: wallet.walletBalanceUsd
              }),
              walletAddress: wallet.walletAddress,
              signalWeight
            });
          }
        }
      }

      const sortedTickers = [...marketSignalMap.entries()]
        .sort((left, right) => right[1].signalWeight - left[1].signalWeight)
        .map(([marketTicker]) => marketTicker);
      const selectedTickers = typeof limit === "number" ? sortedTickers.slice(0, limit) : sortedTickers;
      if (selectedTickers.length === 0) {
        return {
          generatedAt: new Date().toISOString(),
          count: 0,
          markets: []
        };
      }

      const marketRows = await db
        .select()
        .from(markets)
        .where(inArray(markets.marketTicker, selectedTickers))
        .orderBy(desc(markets.lastSeenAt));
      const marketByTicker = new Map(marketRows.map((row) => [row.marketTicker, row]));

      return {
        generatedAt: new Date().toISOString(),
        windowHours: windowHours ?? null,
        count: selectedTickers.length,
        markets: selectedTickers.map((marketTicker) => {
          const market = marketByTicker.get(marketTicker);
          const signal = marketSignalMap.get(marketTicker);
          return {
            marketTicker,
            eventTicker: market?.eventTicker ?? "UNKNOWN",
            title: market?.title ?? marketTicker,
            subtitle: market?.subtitle ?? null,
            status: market?.status ?? null,
            yesBid: market?.yesBid ? Number(market.yesBid) : null,
            yesAsk: market?.yesAsk ? Number(market.yesAsk) : null,
            noBid: market?.noBid ? Number(market.noBid) : null,
            noAsk: market?.noAsk ? Number(market.noAsk) : null,
            walletSignal: {
              type: signal?.signalType ?? "NONE",
              confidencePercent: signal?.confidencePercent ?? 0,
              reason: signal?.reason ?? "No wallet signal",
              walletAddress: signal?.walletAddress ?? null
            }
          };
        })
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
        windowHours: t.Optional(t.Numeric({ minimum: 0, maximum: 24 * 365 * 5 }))
      })
    }
  )
  .get(
    "/:marketTicker/details",
    async ({ params, query, set }) => {
      const windowHours = query.windowHours ?? env.ANALYSIS_WINDOW_HOURS;
      const marketRows = await db
        .select()
        .from(markets)
        .where(eq(markets.marketTicker, params.marketTicker))
        .limit(1);

      if (marketRows.length === 0) {
        set.status = 404;
        return {
          error: "NotFound",
          message: `Market ${params.marketTicker} not found`
        };
      }

      const market = marketRows[0];
      const holders = await listTaggedHoldersForMarket({
        marketTicker: params.marketTicker,
        windowHours
      });

      const holderCountsByTag = holders.reduce(
        (acc, holder) => {
          if (holder.tag === "INSIDER") {
            acc.insider += 1;
          }
          if (holder.tag === "WHALE") {
            acc.whale += 1;
          }
          return acc;
        },
        { insider: 0, whale: 0 }
      );

      const totalLargeOrderUsd = holders.reduce((acc, holder) => acc + holder.largeOrdersUsdTotal, 0);

      return {
        generatedAt: new Date().toISOString(),
        market: {
          marketTicker: market.marketTicker,
          eventTicker: market.eventTicker,
          title: market.title,
          subtitle: market.subtitle,
          status: market.status,
          volume: Number(market.volume ?? 0),
          openInterest: Number(market.openInterest ?? 0),
          yesBid: market.yesBid ? Number(market.yesBid) : null,
          yesAsk: market.yesAsk ? Number(market.yesAsk) : null,
          noBid: market.noBid ? Number(market.noBid) : null,
          noAsk: market.noAsk ? Number(market.noAsk) : null,
          walletSignal: holders[0]
            ? {
                type: holders[0].tag,
                confidencePercent: Math.min(100, Math.round(holders[0].attributionConfidence * 100)),
                reason: toSignalReason({
                  tag: holders[0].tag,
                  walletAgeDays: holders[0].walletAgeDays,
                  largeOrdersUsdTotal: holders[0].largeOrdersUsdTotal,
                  walletBalanceUsd: holders[0].walletBalanceUsd
                }),
                walletAddress: holders[0].walletAddress
              }
            : null
        },
        holders,
        summary: {
          holderCountsByTag,
          totalLargeOrderUsd: Number(totalLargeOrderUsd.toFixed(2)),
          analysisWindowHours: windowHours ?? null
        }
      };
    },
    {
      params: t.Object({
        marketTicker: t.String()
      }),
      query: t.Object({
        windowHours: t.Optional(t.Numeric({ minimum: 0, maximum: 24 * 365 * 5 }))
      })
    }
  )
  .get(
    "/:marketTicker",
    async ({ params }) => {
      return {
        redirectTo: `/markets/${params.marketTicker}/details`
      };
    },
    {
      params: t.Object({
        marketTicker: t.String()
      })
    }
  );
