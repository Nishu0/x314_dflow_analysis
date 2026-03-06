import { env } from "../../config";
import { logger } from "../../lib/pino";

type SolPricePayload = {
  parsed?: Array<{
    id?: string;
    price?: {
      price?: string | number;
      expo?: number;
    };
  }>;
};

let cachedSolUsdPrice: number | null = null;
let cachedAtMs = 0;

export async function getSolUsdPrice(): Promise<number> {
  const now = Date.now();
  const isFresh = cachedSolUsdPrice !== null && now - cachedAtMs < env.WALLET_SOL_PRICE_TTL_MS;

  if (isFresh && cachedSolUsdPrice !== null) {
    return cachedSolUsdPrice;
  }

  try {
    const feedId = env.WALLET_SOL_USD_FEED_ID.startsWith("0x")
      ? env.WALLET_SOL_USD_FEED_ID.slice(2)
      : env.WALLET_SOL_USD_FEED_ID;

    const priceUrl = `${env.WALLET_PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(feedId)}&parsed=true`;

    const response = await fetch(priceUrl, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Price API status ${response.status}`);
    }

    const payload = (await response.json()) as SolPricePayload;
    const priceBlock = payload.parsed?.[0]?.price;
    const rawPrice = priceBlock?.price;
    const expo = typeof priceBlock?.expo === "number" ? priceBlock.expo : 0;

    const numericPrice =
      typeof rawPrice === "number"
        ? rawPrice
        : typeof rawPrice === "string"
          ? Number(rawPrice)
          : Number.NaN;

    const value = Number.isFinite(numericPrice)
      ? numericPrice * Math.pow(10, expo)
      : Number.NaN;

    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error("Invalid SOL/USD payload");
    }

    cachedSolUsdPrice = value;
    cachedAtMs = now;
    return value;
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        fallback: env.WALLET_SOL_USD_ESTIMATE
      },
      "failed to fetch live SOL price, using fallback"
    );

    cachedSolUsdPrice = env.WALLET_SOL_USD_ESTIMATE;
    cachedAtMs = now;

    return env.WALLET_SOL_USD_ESTIMATE;
  }
}
