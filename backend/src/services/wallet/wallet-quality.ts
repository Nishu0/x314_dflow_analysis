import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import { walletAttributions, walletProfiles } from "../../db/schema";

type WalletAttributionRecord = typeof walletAttributions.$inferSelect;

function computeWalletScore(records: WalletAttributionRecord[]): {
  sampleSize: number;
  qualityScore: number;
  hitRate: number;
  timingScore: number;
  specializationScore: number;
  disciplineScore: number;
} {
  const sampleSize = records.length;
  if (sampleSize === 0) {
    return {
      sampleSize,
      qualityScore: 0,
      hitRate: 0,
      timingScore: 0,
      specializationScore: 0,
      disciplineScore: 0
    };
  }

  const avgConfidence =
    records.reduce((acc, row) => acc + Number(row.attributionConfidence), 0) / sampleSize;
  const avgSize = records.reduce((acc, row) => acc + Number(row.sizeUsdEst ?? 0), 0) / sampleSize;
  const confidenceScore = Math.min(100, avgConfidence * 100);
  const timingScore = Math.min(100, 35 + avgConfidence * 50);
  const specializationScore = Math.min(100, 20 + Math.log10(sampleSize + 1) * 25);
  const disciplineScore = Math.min(100, 100 - Math.min(60, avgSize / 100));
  const qualityScore = Math.min(
    100,
    confidenceScore * 0.4 + timingScore * 0.2 + specializationScore * 0.2 + disciplineScore * 0.2
  );

  return {
    sampleSize,
    qualityScore,
    hitRate: confidenceScore,
    timingScore,
    specializationScore,
    disciplineScore
  };
}

export async function recomputeWalletProfiles(windowDays = 30): Promise<number> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(walletAttributions)
    .where(gte(walletAttributions.attributedTime, since))
    .orderBy(desc(walletAttributions.attributedTime));

  const byWallet = new Map<string, WalletAttributionRecord[]>();
  for (const row of rows) {
    const existing = byWallet.get(row.walletAddress) ?? [];
    existing.push(row);
    byWallet.set(row.walletAddress, existing);
  }

  for (const [walletAddress, records] of byWallet.entries()) {
    const scores = computeWalletScore(records);
    await db
      .insert(walletProfiles)
      .values({
        walletAddress,
        sampleSize: scores.sampleSize,
        qualityScore: scores.qualityScore.toFixed(3),
        hitRate: scores.hitRate.toFixed(3),
        timingScore: scores.timingScore.toFixed(3),
        specializationScore: scores.specializationScore.toFixed(3),
        disciplineScore: scores.disciplineScore.toFixed(3),
        categoryRaw: "MIXED",
        categoryNormalized: "OTHER",
        lastScoredAt: new Date(),
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: walletProfiles.walletAddress,
        set: {
          sampleSize: scores.sampleSize,
          qualityScore: scores.qualityScore.toFixed(3),
          hitRate: scores.hitRate.toFixed(3),
          timingScore: scores.timingScore.toFixed(3),
          specializationScore: scores.specializationScore.toFixed(3),
          disciplineScore: scores.disciplineScore.toFixed(3),
          categoryRaw: "MIXED",
          categoryNormalized: "OTHER",
          lastScoredAt: new Date(),
          updatedAt: new Date()
        }
      });
  }

  return byWallet.size;
}

export async function getShadowWatchCandidates(limit = 50): Promise<
  Array<{
    walletAddress: string;
    behaviorScore: number;
    alertType: string;
    evidence: string[];
  }>
> {
  const rows = await db
    .select()
    .from(walletProfiles)
    .where(gte(walletProfiles.sampleSize, 1))
    .orderBy(desc(walletProfiles.qualityScore))
    .limit(limit);

  return rows
    .filter((row) => Number(row.qualityScore ?? 0) >= 65)
    .map((row) => ({
      walletAddress: row.walletAddress,
      behaviorScore: Number(row.qualityScore ?? 0),
      alertType:
        row.sampleSize < 30 ? "PROVISIONAL_NEW_WALLET_HIGH_QUALITY_ACTIVITY" : "NEW_WALLET_LARGE_EARLY_ENTRY",
      evidence: [
        `Sample size: ${row.sampleSize}`,
        `Quality score: ${Number(row.qualityScore ?? 0).toFixed(2)}`
      ]
    }));
}

export async function getRetailPressureSignals(limit = 50): Promise<
  Array<{
    marketTicker: string;
    pressuredSide: "YES" | "NO" | "NEUTRAL";
    retailPressureScore: number;
    contrarianSignal: boolean;
  }>
> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(walletAttributions)
    .where(and(gte(walletAttributions.attributedTime, since), eq(walletAttributions.source, "rpc_replay")))
    .orderBy(desc(walletAttributions.attributedTime));

  const byMarket = new Map<string, WalletAttributionRecord[]>();
  for (const row of rows) {
    const existing = byMarket.get(row.marketTicker) ?? [];
    existing.push(row);
    byMarket.set(row.marketTicker, existing);
  }

  const result: Array<{
    marketTicker: string;
    pressuredSide: "YES" | "NO" | "NEUTRAL";
    retailPressureScore: number;
    contrarianSignal: boolean;
  }> = [];

  for (const [marketTicker, records] of byMarket.entries()) {
    const yes = records.filter((row) => row.side === "YES").length;
    const no = records.filter((row) => row.side === "NO").length;
    const total = yes + no;
    const imbalance = total === 0 ? 0 : Math.abs(yes - no) / total;
    const pressuredSide: "YES" | "NO" | "NEUTRAL" = yes === no ? "NEUTRAL" : yes > no ? "YES" : "NO";
    const retailPressureScore = Math.min(100, Number((imbalance * 100).toFixed(3)));

    result.push({
      marketTicker,
      pressuredSide,
      retailPressureScore,
      contrarianSignal: retailPressureScore >= 65
    });
  }

  return result.sort((a, b) => b.retailPressureScore - a.retailPressureScore).slice(0, limit);
}
