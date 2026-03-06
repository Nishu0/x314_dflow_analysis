import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { env } from "../../config";
import { db } from "../../db/client";
import { walletAttributions } from "../../db/schema";
import { fetchWalletBalanceUsd } from "./rpc-replay";

const STRICT_ATTRIBUTION_SOURCES = ["helius_enhanced", "rpc_replay"] as const;

export type MarketHolderTag = "INSIDER" | "WHALE";

export type MarketHolder = {
  walletAddress: string;
  tag: MarketHolderTag;
  largeOrdersCount: number;
  largeOrdersUsdTotal: number;
  walletBalanceUsd: number | null;
  walletFirstSeenAt: string;
  walletAgeDays: number;
  lastOrderAt: string;
  attributionSource: "helius_enhanced" | "rpc_replay";
  attributionConfidence: number;
  relatedMarketTickers: string[];
};

export type TaggedWalletSignal = {
  walletAddress: string;
  tag: MarketHolderTag;
  largeOrdersCount: number;
  largeOrdersUsdTotal: number;
  walletBalanceUsd: number | null;
  walletFirstSeenAt: string;
  walletAgeDays: number;
  lastOrderAt: string;
  attributionSource: "helius_enhanced" | "rpc_replay";
  attributionConfidence: number;
  relatedMarketTickers: string[];
};

type WalletClassification = {
  tag: MarketHolderTag | "NONE";
  walletBalanceUsd: number | null;
  walletAgeDays: number;
  walletFirstSeenAt: Date;
};

async function classifyWallet(walletAddress: string): Promise<WalletClassification | null> {
  const history = await db
    .select()
    .from(walletAttributions)
    .where(
      and(
        eq(walletAttributions.walletAddress, walletAddress),
        gte(walletAttributions.attributionConfidence, "0.700"),
        inArray(walletAttributions.source, [...STRICT_ATTRIBUTION_SOURCES])
      )
    )
    .orderBy(desc(walletAttributions.attributedTime));

  if (history.length === 0) {
    return null;
  }

  const firstSeenRow = await db
    .select({ attributedTime: walletAttributions.attributedTime })
    .from(walletAttributions)
    .where(
      and(
        eq(walletAttributions.walletAddress, walletAddress),
        gte(walletAttributions.attributionConfidence, "0.700"),
        inArray(walletAttributions.source, [...STRICT_ATTRIBUTION_SOURCES])
      )
    )
    .orderBy(asc(walletAttributions.attributedTime))
    .limit(1);

  if (firstSeenRow.length === 0) {
    return null;
  }

  const firstSeenAt = firstSeenRow[0].attributedTime;
  const now = Date.now();
  const walletAgeDays = Math.max(0, Math.floor((now - firstSeenAt.getTime()) / (24 * 60 * 60 * 1000)));
  const balanceUsd = await fetchWalletBalanceUsd(walletAddress);
  const largeOrders = history.filter((row) => Number(row.sizeUsdEst ?? 0) >= env.LARGE_ORDER_MIN_USD);
  const largeOrdersUsdTotal = largeOrders.reduce((acc, row) => acc + Number(row.sizeUsdEst ?? 0), 0);

  const isInsider = walletAgeDays <= env.INSIDER_MAX_ACCOUNT_AGE_DAYS && largeOrdersUsdTotal >= env.TAG_MIN_ORDER_USD;
  const isWhale =
    walletAgeDays > env.INSIDER_MAX_ACCOUNT_AGE_DAYS &&
    typeof balanceUsd === "number" &&
    balanceUsd >= env.WHALE_MIN_BALANCE_USD &&
    largeOrdersUsdTotal >= env.TAG_MIN_ORDER_USD;

  const tag: WalletClassification["tag"] = isInsider ? "INSIDER" : isWhale ? "WHALE" : "NONE";

  return {
    tag,
    walletBalanceUsd: balanceUsd,
    walletAgeDays,
    walletFirstSeenAt: firstSeenAt
  };
}

export async function listTaggedHoldersForMarket(params: {
  marketTicker: string;
  windowHours?: number;
}): Promise<MarketHolder[]> {
  const taggedWallets = await listTaggedWalletSignals({ windowHours: params.windowHours });
  return taggedWallets
    .filter((wallet) => wallet.relatedMarketTickers.includes(params.marketTicker))
    .sort((a, b) => b.largeOrdersUsdTotal - a.largeOrdersUsdTotal);
}

export async function listTaggedWalletSignals(params: {
  windowHours?: number;
}): Promise<TaggedWalletSignal[]> {
  const effectiveWindowHours =
    typeof params.windowHours === "number"
      ? params.windowHours
      : env.ANALYSIS_WINDOW_HOURS;
  const since =
    typeof effectiveWindowHours === "number" && effectiveWindowHours > 0
      ? new Date(Date.now() - effectiveWindowHours * 60 * 60 * 1000)
      : null;

  const baseConditions = [
    gte(walletAttributions.attributionConfidence, "0.700"),
    inArray(walletAttributions.source, [...STRICT_ATTRIBUTION_SOURCES]),
    gte(walletAttributions.sizeUsdEst, env.LARGE_ORDER_MIN_USD.toFixed(8))
  ];

  if (since) {
    baseConditions.push(gte(walletAttributions.attributedTime, since));
  }

  const rows = await db
    .select()
    .from(walletAttributions)
    .where(and(...baseConditions))
    .orderBy(desc(walletAttributions.attributedTime));

  if (rows.length === 0) {
    return [];
  }

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = grouped.get(row.walletAddress) ?? [];
    existing.push(row);
    grouped.set(row.walletAddress, existing);
  }

  const holders: TaggedWalletSignal[] = [];
  for (const [walletAddress, walletRows] of grouped.entries()) {
    const classification = await classifyWallet(walletAddress);
    if (!classification || classification.tag === "NONE") {
      continue;
    }

    const relatedConditions = [
      eq(walletAttributions.walletAddress, walletAddress),
      gte(walletAttributions.attributionConfidence, "0.700"),
      inArray(walletAttributions.source, [...STRICT_ATTRIBUTION_SOURCES]),
      gte(walletAttributions.sizeUsdEst, env.LARGE_ORDER_MIN_USD.toFixed(8))
    ];

    if (since) {
      relatedConditions.push(gte(walletAttributions.attributedTime, since));
    }

    const relatedRows = await db
      .select({ marketTicker: walletAttributions.marketTicker })
      .from(walletAttributions)
      .where(and(...relatedConditions));

    const relatedMarketTickers = [...new Set(relatedRows.map((row) => row.marketTicker))].sort();
    const largeOrdersCount = walletRows.length;
    const largeOrdersUsdTotal = walletRows.reduce((acc, row) => acc + Number(row.sizeUsdEst ?? 0), 0);
    const attributionConfidence =
      walletRows.reduce((acc, row) => acc + Number(row.attributionConfidence), 0) / largeOrdersCount;
    const preferredSource = walletRows.some((row) => row.source === "helius_enhanced")
      ? "helius_enhanced"
      : "rpc_replay";

    holders.push({
      walletAddress,
      tag: classification.tag,
      largeOrdersCount,
      largeOrdersUsdTotal: Number(largeOrdersUsdTotal.toFixed(2)),
      walletBalanceUsd:
        typeof classification.walletBalanceUsd === "number"
          ? Number(classification.walletBalanceUsd.toFixed(2))
          : null,
      walletFirstSeenAt: classification.walletFirstSeenAt.toISOString(),
      walletAgeDays: classification.walletAgeDays,
      lastOrderAt: walletRows[0].attributedTime.toISOString(),
      attributionSource: preferredSource,
      attributionConfidence: Number(attributionConfidence.toFixed(3)),
      relatedMarketTickers
    });
  }

  return holders.sort((a, b) => b.largeOrdersUsdTotal - a.largeOrdersUsdTotal);
}
