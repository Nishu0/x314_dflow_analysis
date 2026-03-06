import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { env } from "../../config";
import { db } from "../../db/client";
import { walletAttributions } from "../../db/schema";
import { logger } from "../../lib/pino";
import { fetchWalletBalanceUsd } from "../wallet/rpc-replay";

export type WalletMarketSignal = {
  marketTicker: string;
  mode: "MARKET_ONLY" | "WALLET_ENRICHED";
  coverageCount: number;
  dominantSide: "YES" | "NO" | "NEUTRAL";
  qualityScore: number;
  confirmation: boolean;
  signalType: "INSIDER" | "WHALE" | "PENDING" | "NONE";
  signalConfidence: number;
  signalReason: string;
  signalWalletAddress: string | null;
  evidence: string[];
};

export async function runWalletProcessor(params: {
  candidateTickers: string[];
  highVolumeByMarket: Map<string, number>;
  windowStart: Date;
}): Promise<Map<string, WalletMarketSignal>> {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const marketTickers = params.candidateTickers ?? [];
  const recentLargeOrdersByMarket = params.highVolumeByMarket ?? new Map<string, number>();
  const result = new Map<string, WalletMarketSignal>();

  logger.info({ markets: marketTickers.length }, "wallet processor start");

  if (marketTickers.length === 0) {
    return result;
  }

  const attributionRows = await Promise.all(
    marketTickers.map(async (marketTicker) => {
      const rows = await db
        .select()
        .from(walletAttributions)
        .where(
          and(
            eq(walletAttributions.marketTicker, marketTicker),
            gte(walletAttributions.attributedTime, params.windowStart)
          )
        );

      return { marketTicker, rows };
    })
  );

  const totalAttributionsFetched = attributionRows.reduce((acc, row) => acc + row.rows.length, 0);
  const marketsWithAttributions = attributionRows.filter((row) => row.rows.length > 0).length;
  logger.info(
    {
      marketsRequested: marketTickers.length,
      marketsWithAttributions,
      totalAttributionsFetched,
      windowStart: params.windowStart.toISOString()
    },
    "wallet attribution window loaded"
  );

  const strictSources = ["helius_enhanced", "rpc_replay"] as const;
  const firstSeenCache = new Map<string, Date | null>();

  async function getWalletAgeDays(walletAddress: string): Promise<number | null> {
    const cached = firstSeenCache.get(walletAddress);
    if (cached !== undefined) {
      return cached ? Math.max(0, Math.floor((Date.now() - cached.getTime()) / (24 * 60 * 60 * 1000))) : null;
    }

    const rows = await db
      .select({ attributedTime: walletAttributions.attributedTime })
      .from(walletAttributions)
      .where(
        and(
          eq(walletAttributions.walletAddress, walletAddress),
          inArray(walletAttributions.source, [...strictSources])
        )
      )
      .orderBy(asc(walletAttributions.attributedTime))
      .limit(1);

    const firstSeen = rows[0]?.attributedTime ?? null;
    firstSeenCache.set(walletAddress, firstSeen);
    return firstSeen ? Math.max(0, Math.floor((Date.now() - firstSeen.getTime()) / (24 * 60 * 60 * 1000))) : null;
  }

  for (const { marketTicker, rows } of attributionRows) {
    const highConfidenceRows = rows.filter(
      (row) =>
        Number(row.attributionConfidence) >= 0.7 &&
        (row.source === "helius_enhanced" || row.source === "rpc_replay")
    );
    const yesCount = highConfidenceRows.filter((row) => row.side === "YES").length;
    const noCount = highConfidenceRows.filter((row) => row.side === "NO").length;
    const dominantSide = yesCount === noCount ? "NEUTRAL" : yesCount > noCount ? "YES" : "NO";
    const coverageCount = highConfidenceRows.length;
    const qualityScore = Math.min(100, coverageCount * 6);
    const confirmation = dominantSide !== "NEUTRAL";

    const byWallet = new Map<string, { tradeCount: number; totalUsd: number; side: "YES" | "NO" | "NEUTRAL" }>();
    for (const row of highConfidenceRows) {
      const existing = byWallet.get(row.walletAddress) ?? {
        tradeCount: 0,
        totalUsd: 0,
        side: "NEUTRAL"
      };
      const nextTradeCount = existing.tradeCount + 1;
      const side =
        existing.side === "NEUTRAL"
          ? row.side
          : existing.side === row.side
            ? existing.side
            : "NEUTRAL";

      byWallet.set(row.walletAddress, {
        tradeCount: nextTradeCount,
        totalUsd: existing.totalUsd + Number(row.sizeUsdEst ?? 0),
        side
      });
    }

    const recentHighVolumeDetected =
      (recentLargeOrdersByMarket.get(marketTicker) ?? 0) > 0 && oneMinuteAgo <= now;

    let signalType: "INSIDER" | "WHALE" | "PENDING" | "NONE" = "NONE";
    let signalConfidence = 0;
    let signalReason = "No insider/whale wallet signal detected";
    let signalWalletAddress: string | null = null;

    const rankedWallets = [...byWallet.entries()]
      .filter((entry) => entry[1].totalUsd >= env.LARGE_ORDER_MIN_USD)
      .sort((left, right) => right[1].totalUsd - left[1].totalUsd)
      .slice(0, 12);
    const rankedWalletSamples = rankedWallets.slice(0, 5).map(([walletAddress, stats]) => ({
      walletAddress,
      tradeCount: stats.tradeCount,
      totalUsd: Number(stats.totalUsd.toFixed(2)),
      side: stats.side
    }));

    for (const [walletAddress, stats] of rankedWallets) {
      const balanceUsd = await fetchWalletBalanceUsd(walletAddress);
      const walletAgeDays = await getWalletAgeDays(walletAddress);

      const insiderCandidate =
        typeof walletAgeDays === "number" &&
        walletAgeDays <= env.INSIDER_MAX_ACCOUNT_AGE_DAYS &&
        stats.totalUsd >= env.TAG_MIN_ORDER_USD;
      const whaleCandidate =
        typeof walletAgeDays === "number" &&
        walletAgeDays > env.INSIDER_MAX_ACCOUNT_AGE_DAYS &&
        typeof balanceUsd === "number" &&
        balanceUsd >= env.WHALE_MIN_BALANCE_USD &&
        stats.totalUsd >= env.TAG_MIN_ORDER_USD;

      if (insiderCandidate) {
        signalType = "INSIDER";
        signalConfidence = Math.min(100, Math.round(60 + stats.totalUsd / 1000));
        signalReason = `New wallet (~${walletAgeDays}d old) placed ${stats.tradeCount} large order(s) totaling $${stats.totalUsd.toFixed(2)}`;
        signalWalletAddress = walletAddress;
        break;
      }

      if (whaleCandidate) {
        signalType = "WHALE";
        signalConfidence = Math.min(100, Math.round(55 + (balanceUsd - env.WHALE_MIN_BALANCE_USD) / 2000));
        signalReason = `High-balance wallet (~$${balanceUsd.toFixed(2)}) traded $${stats.totalUsd.toFixed(2)} in this market`;
        signalWalletAddress = walletAddress;
      }
    }

    if (signalType === "NONE" && recentHighVolumeDetected && highConfidenceRows.length === 0) {
      signalType = "PENDING";
      signalConfidence = 40;
      signalReason = "High-volume order detected in last minute; wallet attribution pending";
    }

    result.set(marketTicker, {
      marketTicker,
      mode: coverageCount > 0 ? "WALLET_ENRICHED" : "MARKET_ONLY",
      coverageCount,
      dominantSide,
      qualityScore,
      confirmation,
      signalType,
      signalConfidence,
      signalReason,
      signalWalletAddress,
      evidence:
        coverageCount > 0
          ? [
              `Wallet attribution coverage: ${coverageCount} records`,
              `Wallet dominant side: ${dominantSide}`,
              signalReason
            ]
          : [signalReason]
    });

    logger.debug(
      {
        marketTicker,
        attributions: rows.length,
        highConfidence: highConfidenceRows.length,
        distinctWallets: byWallet.size,
        rankedWalletSamples,
        mode: coverageCount > 0 ? "WALLET_ENRICHED" : "MARKET_ONLY",
        signalType,
        signalWalletAddress
      },
      "wallet processor market complete"
    );

    if (signalType !== "NONE") {
      logger.info(
        {
          marketTicker,
          signalType,
          signalConfidence,
          signalWalletAddress,
          coverageCount,
          dominantSide,
          reason: signalReason,
          rankedWalletSamples
        },
        "wallet signal emitted"
      );
    }
  }

  logger.info({ markets: result.size }, "wallet processor completed");
  return result;
}
