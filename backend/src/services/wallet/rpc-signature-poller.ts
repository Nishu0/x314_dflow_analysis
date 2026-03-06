import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { env } from "../../config";
import { db } from "../../db/client";
import { ingestCursors, marketAccounts, tradeFacts } from "../../db/schema";
import { logger } from "../../lib/pino";
import { createRpcAttribution } from "./rpc-attribution";

type SignatureInfo = {
  signature: string;
  slot?: number;
  blockTime?: number;
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

async function rpcCall<T>(method: string, params: unknown[]): Promise<T | null> {
  if (!env.SOLANA_RPC_URL) {
    logger.warn({ method }, "rpc poll skipped because SOLANA_RPC_URL is not configured");
    return null;
  }

  const response = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    return null;
  }

  return payload.result ?? null;
}

async function getCursorForAddress(address: string): Promise<string | null> {
  const key = `rpc_sig:${address}`;
  const rows = await db.select().from(ingestCursors).where(eq(ingestCursors.sourceKey, key)).limit(1);
  return rows[0]?.cursorValue ?? null;
}

async function setCursorForAddress(address: string, signature: string): Promise<void> {
  const key = `rpc_sig:${address}`;
  await db
    .insert(ingestCursors)
    .values({
      sourceKey: key,
      cursorValue: signature,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: ingestCursors.sourceKey,
      set: {
        cursorValue: signature,
        updatedAt: new Date()
      }
    });
}

type PollStats = {
  addressesPolled: number;
  signaturesSeen: number;
  newSignaturesProcessed: number;
  attributionSuccess: number;
  attributionFailures: number;
};

type AttributionFailureSample = {
  address: string;
  marketTicker: string;
  signature: string;
  reason: string;
};

async function resolveMarketSizeUsdHint(marketTicker: string): Promise<number | undefined> {
  const lookback = new Date(Date.now() - 15 * 60 * 1000);
  const rows = await db
    .select({ notionalUsdEst: tradeFacts.notionalUsdEst })
    .from(tradeFacts)
    .where(
      and(
        eq(tradeFacts.marketTicker, marketTicker),
        gte(tradeFacts.createdTime, lookback),
        gte(tradeFacts.notionalUsdEst, env.LARGE_ORDER_MIN_USD.toFixed(8))
      )
    )
    .orderBy(desc(tradeFacts.createdTime))
    .limit(1);

  if (!rows[0]?.notionalUsdEst) {
    return undefined;
  }

  const parsed = Number(rows[0].notionalUsdEst);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function pollRpcAttributionsForMarketAccounts(params: {
  candidateTickers: string[];
}): Promise<PollStats> {
  const tickers = [...new Set(params.candidateTickers)].slice(0, env.RPC_POLL_MARKET_LIMIT);
  if (tickers.length === 0) {
    return {
      addressesPolled: 0,
      signaturesSeen: 0,
      newSignaturesProcessed: 0,
      attributionSuccess: 0,
      attributionFailures: 0
    };
  }

  const rows = await db
    .select()
    .from(marketAccounts)
    .where(inArray(marketAccounts.marketTicker, tickers))
    .orderBy(desc(marketAccounts.updatedAt));

  logger.info(
    {
      candidateTickerCount: tickers.length,
      marketAccountRows: rows.length,
      candidateTickersSample: tickers.slice(0, 12)
    },
    "rpc poll market account candidates loaded"
  );

  const addressTargets = new Map<string, { marketTicker: string; side?: "YES" | "NO" }>();
  for (const row of rows) {
    addressTargets.set(row.yesMint, { marketTicker: row.marketTicker, side: "YES" });
    addressTargets.set(row.noMint, { marketTicker: row.marketTicker, side: "NO" });
    addressTargets.set(row.marketLedger, { marketTicker: row.marketTicker, side: undefined });
  }

  const addressTargetSamples = [...addressTargets.entries()].slice(0, 20).map(([address, target]) => ({
    address,
    marketTicker: target.marketTicker,
    side: target.side
  }));
  logger.info(
    {
      uniqueAddressesToPoll: addressTargets.size,
      addressTargetSamples
    },
    "rpc poll address targets prepared"
  );

  let signaturesSeen = 0;
  let newSignaturesProcessed = 0;
  let attributionSuccess = 0;
  let attributionFailures = 0;
  const failureSamples: AttributionFailureSample[] = [];

  for (const [address, target] of addressTargets.entries()) {
    const marketSizeUsdHint = await resolveMarketSizeUsdHint(target.marketTicker);
    const minBlockTime = Math.floor((Date.now() - env.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000) / 1000);
    const cursor = await getCursorForAddress(address);
    const signatures =
      (await rpcCall<SignatureInfo[]>("getSignaturesForAddress", [address, { limit: env.RPC_POLL_SIGNATURE_LIMIT }])) ?? [];

    signaturesSeen += signatures.length;
    const newestSignature = signatures[0]?.signature;

    const newOnes: SignatureInfo[] = [];
    let droppedOlderThanWindow = 0;
    for (const item of signatures) {
      if (!item.signature) {
        continue;
      }
      if (cursor && item.signature === cursor) {
        break;
      }
      if (typeof item.blockTime === "number" && item.blockTime < minBlockTime) {
        droppedOlderThanWindow += 1;
        continue;
      }
      newOnes.push(item);
    }

    logger.debug(
      {
        address,
        marketTicker: target.marketTicker,
        side: target.side,
        marketSizeUsdHint,
        cursor,
        signaturesFetched: signatures.length,
        newSignatures: newOnes.length,
        droppedOlderThanWindow,
        newestSignature
      },
      "rpc poll address fetched signatures"
    );

    for (const item of newOnes.reverse()) {
      newSignaturesProcessed += 1;
      try {
        await createRpcAttribution({
          signature: item.signature,
          marketTicker: target.marketTicker,
          side: target.side,
          sizeUsdEst: marketSizeUsdHint
        });
        attributionSuccess += 1;
      } catch (error) {
        attributionFailures += 1;
        failureSamples.push({
          address,
          marketTicker: target.marketTicker,
          signature: item.signature,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (newestSignature) {
      await setCursorForAddress(address, newestSignature);
    }
  }

  const stats = {
    addressesPolled: addressTargets.size,
    signaturesSeen,
    newSignaturesProcessed,
    attributionSuccess,
    attributionFailures
  };

  logger.info(
    {
      ...stats,
      failureSamples: failureSamples.slice(0, 20)
    },
    "rpc signature poll completed"
  );
  return stats;
}
