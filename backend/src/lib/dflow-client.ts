import { env } from "../config";

export type DflowMarket = {
  id: string;
  slug?: string;
  question?: string;
  title?: string;
  category?: string;
  status?: string;
  endDate?: string;
  yesPrice?: number;
  noPrice?: number;
  volume24h?: number;
  volumeTotal?: number;
  raw?: unknown;
};

const jsonHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${env.DFLOW_API_KEY}`
};

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeMarket(item: any): DflowMarket {
  return {
    id: String(item.id ?? item.marketId ?? item.slug ?? crypto.randomUUID()),
    slug: item.slug,
    question: item.question,
    title: item.title,
    category: item.category,
    status: item.status,
    endDate: item.endDate ?? item.closeTime ?? item.resolutionDate,
    yesPrice: Number(item.yesPrice ?? item.bestYesPrice ?? item.outcomes?.[0]?.price ?? 0),
    noPrice: Number(item.noPrice ?? item.bestNoPrice ?? item.outcomes?.[1]?.price ?? 0),
    volume24h: Number(item.volume24h ?? item.dayVolume ?? 0),
    volumeTotal: Number(item.volumeTotal ?? item.liquidity ?? item.totalVolume ?? 0),
    raw: item
  };
}

export class DflowClient {
  constructor(
    private readonly apiBaseUrl = env.DFLOW_API_BASE_URL,
    private readonly pondBaseUrl = env.DFLOW_POND_BASE_URL
  ) {}

  async listMarkets(limit = 50): Promise<DflowMarket[]> {
    // Primary attempt: API host
    const apiUrl = `${this.apiBaseUrl}/v1/markets?limit=${limit}`;
    const apiResponse = await fetch(apiUrl, { headers: jsonHeaders });

    if (apiResponse.ok) {
      const payload = (await safeJson(apiResponse)) as any;
      const records = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.markets)
          ? payload.markets
          : [];
      return records.map(normalizeMarket);
    }

    // Fallback: pond host
    const pondUrl = `${this.pondBaseUrl}/api/v1/markets?limit=${limit}`;
    const pondResponse = await fetch(pondUrl, { headers: jsonHeaders });

    if (!pondResponse.ok) {
      const errorPayload = await safeJson(pondResponse);
      throw new Error(
        `Unable to fetch markets from dFlow. Status=${pondResponse.status}. Payload=${JSON.stringify(errorPayload)}`
      );
    }

    const pondPayload = (await safeJson(pondResponse)) as any;
    const pondRecords = Array.isArray(pondPayload)
      ? pondPayload
      : Array.isArray(pondPayload?.markets)
        ? pondPayload.markets
        : [];

    return pondRecords.map(normalizeMarket);
  }
}
