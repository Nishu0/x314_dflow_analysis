import type { DflowMarket } from "../lib/dflow-client";

export type ConvictionBand = "LOW" | "MEDIUM" | "HIGH";

export type MarketSignal = {
  marketId: string;
  slug?: string;
  headline: string;
  convictionScore: number;
  convictionBand: ConvictionBand;
  signalBias: "YES" | "NO" | "NEUTRAL";
  confidenceGap: number;
  momentum24h: number;
  notes: string[];
};

function toNumber(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value);
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bandFromScore(score: number): ConvictionBand {
  if (score >= 70) {
    return "HIGH";
  }

  if (score >= 45) {
    return "MEDIUM";
  }

  return "LOW";
}

export function computeSignal(market: DflowMarket): MarketSignal {
  const yesPrice = clamp(0, toNumber(market.yesPrice), 1);
  const noPrice = clamp(0, toNumber(market.noPrice), 1);
  const volume24h = Math.max(0, toNumber(market.volume24h));

  const impliedGap = Math.abs(yesPrice - noPrice);
  const volumeFactor = clamp(0, Math.log10(volume24h + 1) / 3, 1);
  const imbalanceFactor = clamp(0, impliedGap * 1.6, 1);

  const convictionScore = Math.round((volumeFactor * 0.45 + imbalanceFactor * 0.55) * 100);
  const confidenceGap = Math.round(impliedGap * 1000) / 10;
  const momentum24h = Math.round(volumeFactor * 1000) / 10;

  const signalBias: MarketSignal["signalBias"] =
    yesPrice > noPrice ? "YES" : noPrice > yesPrice ? "NO" : "NEUTRAL";

  const notes: string[] = [
    `24h liquidity strength: ${momentum24h}%`,
    `Price imbalance gap: ${confidenceGap}%`
  ];

  if (confidenceGap > 25) {
    notes.push("High dislocation detected between implied outcome sides.");
  }

  return {
    marketId: market.id,
    slug: market.slug,
    headline: market.title ?? market.question ?? market.slug ?? market.id,
    convictionScore,
    convictionBand: bandFromScore(convictionScore),
    signalBias,
    confidenceGap,
    momentum24h,
    notes
  };
}

export function rankSignals(markets: DflowMarket[]): MarketSignal[] {
  return markets
    .map(computeSignal)
    .sort((a, b) => b.convictionScore - a.convictionScore);
}
