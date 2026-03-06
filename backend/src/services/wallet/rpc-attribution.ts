import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { markets, walletAttributions } from "../../db/schema";
import { fetchTransactionForReplay } from "./rpc-replay";

export type RpcAttributionInput = {
  signature: string;
  marketTicker: string;
  side?: "YES" | "NO";
  walletAddress?: string;
  sizeUsdEst?: number;
};

function deriveSide(balanceDelta: number): "YES" | "NO" {
  return balanceDelta >= 0 ? "YES" : "NO";
}

export async function createRpcAttribution(input: RpcAttributionInput): Promise<{
  attributionId: string;
  walletAddress: string;
  side: "YES" | "NO";
  confidence: number;
}> {
  const market = await db.select().from(markets).where(eq(markets.marketTicker, input.marketTicker)).limit(1);
  if (market.length === 0) {
    throw new Error(`Market ${input.marketTicker} not found`);
  }

  const tx = await fetchTransactionForReplay(input.signature);

  const walletAddress = input.walletAddress ?? tx?.signer ?? "";
  if (!walletAddress) {
    throw new Error("Unable to derive wallet address from RPC transaction");
  }

  const balanceDelta = tx?.nativeBalanceChange ?? 0;
  const side = input.side ?? deriveSide(balanceDelta);
  const sizeUsdEst = input.sizeUsdEst ?? Math.abs(balanceDelta);
  const confidence = tx ? 0.7 : 0.55;
  const attributedTime = tx?.blockTime ? new Date(tx.blockTime * 1000) : new Date();
  const attributionId = `rpc:${input.signature}:${input.marketTicker}:${walletAddress}:${side}`;

  await db
    .insert(walletAttributions)
    .values({
      attributionId,
      walletAddress,
      marketTicker: input.marketTicker,
      side,
      sizeContracts: null,
      sizeUsdEst: sizeUsdEst.toFixed(8),
      attributedTime,
      source: "rpc_replay",
      attributionConfidence: confidence.toFixed(3)
    })
    .onConflictDoNothing({ target: walletAttributions.attributionId });

  return {
    attributionId,
    walletAddress,
    side,
    confidence
  };
}
