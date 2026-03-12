const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// Types
export interface TrendingMarket {
  marketTicker: string;
  eventTicker: string;
  title: string;
  subtitle?: string;
  status: string;
  yesBid?: number;
  yesAsk?: number;
  impliedProbability?: number;
  totalNotionalUsd?: number;
  tradeCount?: number;
  sentimentBias?: string;
  closeTime?: string;
  category?: string;
}

export interface MarketIntelligence {
  generatedAt: string;
  marketTicker: string;
  windowHours: number;
  market: {
    title: string;
    subtitle?: string;
    status: string;
    yesBid?: number;
    yesAsk?: number;
    noBid?: number;
    noAsk?: number;
    volume?: number;
    openInterest?: number;
    impliedProbability?: number;
    priceBias?: string;
    closeTime?: string;
    eventTicker?: string;
  };
  tradeFlow: {
    tradeCount: number;
    notionalUsd: number;
    largeOrderCount: number;
    sentimentBias: string;
  };
  walletIntelligence: {
    distinctWallets: number;
    walletBias: string;
    topWallets: Array<{
      walletAddress: string;
      side: string;
      sizeUsd: number;
      qualityScore?: number;
      tag?: string;
    }>;
    dislocation?: boolean;
    dislocationType?: string;
  };
  conviction: {
    score: number;
    band: string;
    notes: string[];
  };
}

export interface HighConvictionMarket {
  marketTicker: string;
  title: string;
  subtitle?: string;
  status: string;
  closeTime?: string | null;
  yesBid?: number | null;
  yesAsk?: number | null;
  smartFlow: {
    dominantSide: string;
    yesUsd: number;
    noUsd: number;
    totalUsd: number;
    walletCount: number;
    avgConfidence: number;
    convictionRatio: number; // 0-1
  };
}

export interface OpportunityMarket {
  marketTicker: string;
  title: string;
  status: string;
  closeTime?: string | null;
  yesBid?: number | null;
  yesAsk?: number | null;
  impliedProbabilityYes: number;
  priceBias: string;
  walletBias: string;
  walletYesUsd: number;
  walletNoUsd: number;
  walletCount: number;
  isDislocation: boolean;
  opportunityNote: string;
}

export interface PricePoint {
  time: string;
  yesBid?: number;
  yesAsk?: number;
  yesMid?: number;
  noBid?: number;
  noAsk?: number;
}

// API calls
export const api = {
  getTrending: (windowHours = 24, limit = 20) =>
    get<{ markets: TrendingMarket[]; generatedAt: string }>("/api/v1/markets/trending", {
      windowHours,
      limit,
    }),

  getMarketIntelligence: (marketTicker: string, windowHours = 24) =>
    post<MarketIntelligence>("/api/v1/markets/intelligence", { marketTicker, windowHours }),

  getHighConviction: (windowHours = 24, limit = 20, minWallets = 2) =>
    get<{ markets: HighConvictionMarket[]; generatedAt: string }>(
      "/api/v1/markets/high-conviction",
      { windowHours, limit, minWallets }
    ),

  getOpportunities: (windowHours = 24, limit = 20) =>
    get<{ opportunities: OpportunityMarket[]; generatedAt: string; count: number }>(
      "/api/v1/markets/opportunities",
      { windowHours, limit }
    ),

  getPriceHistory: (marketTicker: string, windowHours = 24, limit = 48) =>
    get<{ snapshots: PricePoint[]; generatedAt: string }>("/api/v1/markets/price-history", {
      marketTicker,
      windowHours,
      limit,
    }),

  getWhales: (windowHours = 24, minUsd = 500, limit = 10) =>
    get<{ trades: unknown[]; generatedAt: string }>("/api/v1/trades/whales", {
      windowHours,
      minUsd,
      limit,
    }),

  getPlatformStats: (windowHours = 24) =>
    get<Record<string, unknown>>("/api/v1/platform/stats", { windowHours }),
};
