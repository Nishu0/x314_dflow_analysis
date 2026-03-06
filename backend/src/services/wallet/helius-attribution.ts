import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { heliusWebhookEvents, marketAccounts, walletAttributions } from "../../db/schema";
import type { JsonObject, JsonValue } from "../../types/json";
import { fetchTransactionForReplay, type RpcReplayTransaction } from "./rpc-replay";

type HeliusWebhookEnvelope = {
  webhookEventId?: string;
  signature?: string;
  slot?: number;
  timestamp?: number;
  accountData?: Array<{
    account: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      mint: string;
      userAccount: string;
      rawTokenAmount: {
        tokenAmount: string;
      };
    }>;
  }>;
};

type ParsedAttribution = {
  walletAddress: string;
  marketTicker: string;
  side: "YES" | "NO";
  sizeUsdEst: number;
  attributedTime: Date;
  confidence: number;
};

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function parseEnvelope(payload: JsonValue): HeliusWebhookEnvelope {
  if (!isObject(payload)) {
    return {};
  }

  return {
    webhookEventId: asString(payload.webhookEventId),
    signature: asString(payload.signature),
    slot: asNumber(payload.slot),
    timestamp: asNumber(payload.timestamp)
  };
}

export async function persistHeliusWebhookPayload(payload: JsonValue): Promise<number> {
  const envelope = parseEnvelope(payload);

  const inserted = await db
    .insert(heliusWebhookEvents)
    .values({
      webhookEventId: envelope.webhookEventId ?? null,
      signature: envelope.signature ?? null,
      slot: envelope.slot ?? null,
      payload,
      processed: false
    })
    .returning({ id: heliusWebhookEvents.id });

  return inserted[0]?.id ?? 0;
}

function parseSide(value: JsonValue | undefined): "YES" | "NO" | null {
  if (value === "YES" || value === "NO") {
    return value;
  }

  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "YES") {
      return "YES";
    }
    if (upper === "NO") {
      return "NO";
    }
  }

  return null;
}

function extractAttributionsFromObject(payload: JsonObject): ParsedAttribution[] {
  const marketTicker = asString(payload.marketTicker);
  const walletAddress = asString(payload.walletAddress);
  const side = parseSide(payload.side);
  const sizeUsdEst = asNumber(payload.sizeUsdEst) ?? 0;
  const rawTs = asNumber(payload.timestamp);
  const attributedTime = rawTs ? new Date((rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs)) : new Date();

  if (marketTicker && walletAddress && side) {
    return [
      {
        walletAddress,
        marketTicker,
        side,
        sizeUsdEst,
        attributedTime,
        confidence: 0.9
      }
    ];
  }

  const inferredMarketTicker = asString(payload.market_ticker) ?? asString(payload.ticker) ?? "";
  const accountData = asArray(payload.accountData);

  if (!inferredMarketTicker || accountData.length === 0) {
    return [];
  }

  const parsed: ParsedAttribution[] = [];
  for (const accountEntry of accountData) {
    const accountObj = asObject(accountEntry);
    if (!accountObj) {
      continue;
    }

    const account = asString(accountObj.account);
    if (!account) {
      continue;
    }

    const nativeDelta = asNumber(accountObj.nativeBalanceChange) ?? 0;
    const tokenBalanceChanges = asArray(accountObj.tokenBalanceChanges);
    let sizeFromTokens = 0;
    for (const tokenChange of tokenBalanceChanges) {
      const tokenObj = asObject(tokenChange);
      if (!tokenObj) {
        continue;
      }
      const rawToken = asObject(tokenObj.rawTokenAmount);
      const tokenAmountString = rawToken ? asString(rawToken.tokenAmount) : undefined;
      if (tokenAmountString) {
        const parsedTokenAmount = Number(tokenAmountString);
        if (Number.isFinite(parsedTokenAmount)) {
          sizeFromTokens += parsedTokenAmount;
        }
      }
    }

    const sideFromDelta: "YES" | "NO" = nativeDelta >= 0 ? "YES" : "NO";
    parsed.push({
      walletAddress: account,
      marketTicker: inferredMarketTicker,
      side: sideFromDelta,
      sizeUsdEst: Math.abs(nativeDelta) + sizeFromTokens,
      attributedTime,
      confidence: 0.7
    });
  }

  return parsed;
}

type MintMarketMatch = {
  marketTicker: string;
  side: "YES" | "NO";
};

async function resolveMintToMarket(mint: string): Promise<MintMarketMatch | null> {
  const byYes = await db
    .select({ marketTicker: marketAccounts.marketTicker })
    .from(marketAccounts)
    .where(eq(marketAccounts.yesMint, mint))
    .limit(1);
  if (byYes[0]) {
    return { marketTicker: byYes[0].marketTicker, side: "YES" };
  }

  const byNo = await db
    .select({ marketTicker: marketAccounts.marketTicker })
    .from(marketAccounts)
    .where(eq(marketAccounts.noMint, mint))
    .limit(1);
  if (byNo[0]) {
    return { marketTicker: byNo[0].marketTicker, side: "NO" };
  }

  return null;
}

async function deriveAttributionsFromMints(payload: JsonValue): Promise<ParsedAttribution[]> {
  const entries: JsonObject[] = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (isObject(item)) {
        entries.push(item);
      }
    }
  } else if (isObject(payload)) {
    entries.push(payload);
  }

  const result: ParsedAttribution[] = [];

  for (const entry of entries) {
    const rawTs = asNumber(entry.timestamp);
    const attributedTime = rawTs ? new Date((rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs)) : new Date();
    const accountData = asArray(entry.accountData);

    for (const accountEntry of accountData) {
      const accountObj = asObject(accountEntry);
      if (!accountObj) {
        continue;
      }

      const nativeDelta = asNumber(accountObj.nativeBalanceChange) ?? 0;
      const tokenBalanceChanges = asArray(accountObj.tokenBalanceChanges);

      for (const tokenChange of tokenBalanceChanges) {
        const tokenObj = asObject(tokenChange);
        if (!tokenObj) {
          continue;
        }

        const mint = asString(tokenObj.mint);
        const userAccount = asString(tokenObj.userAccount) ?? asString(accountObj.account);
        if (!mint || !userAccount) {
          continue;
        }

        const match = await resolveMintToMarket(mint);
        if (!match) {
          continue;
        }

        const rawToken = asObject(tokenObj.rawTokenAmount);
        const tokenAmountString = rawToken ? asString(rawToken.tokenAmount) : undefined;
        const tokenAmount = tokenAmountString ? Number(tokenAmountString) : 0;
        const tokenSize = Number.isFinite(tokenAmount) ? Math.abs(tokenAmount) : 0;
        const sizeUsdEst = Math.max(0, Math.abs(nativeDelta)) + tokenSize;

        result.push({
          walletAddress: userAccount,
          marketTicker: match.marketTicker,
          side: match.side,
          sizeUsdEst,
          attributedTime,
          confidence: 0.8
        });
      }
    }
  }

  return result;
}

export function extractHeliusAttributions(payload: JsonValue): ParsedAttribution[] {
  if (!isObject(payload)) {
    if (Array.isArray(payload)) {
      return payload.flatMap((entry) => {
        if (!isObject(entry)) {
          return [];
        }

        return extractAttributionsFromObject(entry);
      });
    }

    return [];
  }

  return extractAttributionsFromObject(payload);
}

function deriveAttributionsFromRpc(
  _signature: string,
  marketTicker: string,
  rpcTx: RpcReplayTransaction
): ParsedAttribution[] {
  const account = rpcTx.signer ?? "";
  const delta = rpcTx.nativeBalanceChange;
  if (!account || !marketTicker) {
    return [];
  }

  return [
    {
      walletAddress: account,
      marketTicker,
      side: delta >= 0 ? "YES" : "NO",
      sizeUsdEst: Math.abs(delta),
      attributedTime: new Date(),
      confidence: 0.6
    }
  ];
}

export async function processHeliusWebhookEvent(eventId: number): Promise<{ attributionCount: number }> {
  const rows = await db.select().from(heliusWebhookEvents).where(eq(heliusWebhookEvents.id, eventId)).limit(1);
  const event = rows[0];
  if (!event) {
    return { attributionCount: 0 };
  }

  let attributions = extractHeliusAttributions(event.payload);
  if (attributions.length === 0) {
    attributions = await deriveAttributionsFromMints(event.payload);
  }

  for (const item of attributions) {
    const attributionId = `${eventId}:${item.walletAddress}:${item.marketTicker}:${item.side}`;
    await db
      .insert(walletAttributions)
      .values({
        attributionId,
        walletAddress: item.walletAddress,
        marketTicker: item.marketTicker,
        side: item.side,
        sizeContracts: null,
        sizeUsdEst: item.sizeUsdEst.toFixed(8),
        attributedTime: item.attributedTime,
        source: "helius_enhanced",
        attributionConfidence: item.confidence.toFixed(3)
      })
      .onConflictDoNothing({ target: walletAttributions.attributionId });
  }

  await db
    .update(heliusWebhookEvents)
    .set({
      processed: true,
      processedAt: new Date(),
      error: null
    })
    .where(and(eq(heliusWebhookEvents.id, eventId), eq(heliusWebhookEvents.processed, false)));

  return { attributionCount: attributions.length };
}

export async function reconcileHeliusEventWithRpc(eventId: number): Promise<{
  rpcAttributionCount: number;
}> {
  const rows = await db.select().from(heliusWebhookEvents).where(eq(heliusWebhookEvents.id, eventId)).limit(1);
  const event = rows[0];
  if (!event) {
    return { rpcAttributionCount: 0 };
  }

  const envelope = parseEnvelope(event.payload);
  const signature = envelope.signature;
  if (!signature) {
    return { rpcAttributionCount: 0 };
  }

  const parsed = extractHeliusAttributions(event.payload);
  const marketTicker = parsed[0]?.marketTicker ?? "";
  if (!marketTicker) {
    return { rpcAttributionCount: 0 };
  }

  const rpcTx = await fetchTransactionForReplay(signature);
  if (!rpcTx) {
    return { rpcAttributionCount: 0 };
  }

  const rpcAttributions = deriveAttributionsFromRpc(signature, marketTicker, rpcTx);
  for (const item of rpcAttributions) {
    const attributionId = `rpc:${eventId}:${item.walletAddress}:${item.marketTicker}:${item.side}`;
    await db
      .insert(walletAttributions)
      .values({
        attributionId,
        walletAddress: item.walletAddress,
        marketTicker: item.marketTicker,
        side: item.side,
        sizeContracts: null,
        sizeUsdEst: item.sizeUsdEst.toFixed(8),
        attributedTime: item.attributedTime,
        source: "rpc_replay",
        attributionConfidence: item.confidence.toFixed(3)
      })
      .onConflictDoNothing({ target: walletAttributions.attributionId });
  }

  return {
    rpcAttributionCount: rpcAttributions.length
  };
}
