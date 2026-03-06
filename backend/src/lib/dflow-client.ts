import { env } from "../config";
import { logger } from "./pino";

type DflowMarketApi = {
  id?: string;
  ticker?: string;
  marketTicker?: string;
  eventTicker?: string;
  event_ticker?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  closeTime?: number | string;
  close_time?: number | string;
  endDate?: number | string;
  yesBid?: number | string;
  yes_bid?: number | string;
  yesAsk?: number | string;
  yes_ask?: number | string;
  noBid?: number | string;
  no_bid?: number | string;
  noAsk?: number | string;
  no_ask?: number | string;
  volume24h?: number | string;
  volume_24h?: number | string;
  dayVolume?: number | string;
  openInterest?: number | string;
  open_interest?: number | string;
};

type DflowMarketsResponse = {
  markets?: DflowMarketApi[];
};

type DflowTradeApi = {
  tradeId?: string;
  trade_id?: string;
  ticker?: string;
  marketTicker?: string;
  market_ticker?: string;
  createdTime?: number | string;
  created_time?: number | string;
  takerSide?: string;
  taker_side?: string;
  count?: number | string;
  yesPriceDollars?: number | string;
  yes_price_dollars?: number | string;
  noPriceDollars?: number | string;
  no_price_dollars?: number | string;
  yesPrice?: number | string;
  noPrice?: number | string;
};

type DflowTradesResponse = {
  trades?: DflowTradeApi[];
  cursor?: string;
};

type DflowOrderbookApi = {
  sequence?: number | string;
  yes_bids?: Record<string, number | string>;
  no_bids?: Record<string, number | string>;
};

export type DflowMarket = {
  id: string;
  marketTicker: string;
  eventTicker: string;
  title?: string;
  subtitle?: string;
  status?: string;
  closeTime?: Date;
  yesPrice?: number;
  noPrice?: number;
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  volume24h?: number;
  openInterest?: number;
  raw?: DflowMarketApi;
};

export type DflowTrade = {
  tradeId: string;
  marketTicker: string;
  createdTime: Date;
  takerSide: "YES" | "NO" | "UNKNOWN";
  count: number;
  yesPriceDollars: number;
  noPriceDollars: number;
  notionalUsdEst: number;
};

export type DflowOrderbook = {
  marketTicker: string;
  sequence: number | null;
  yesBids: Record<string, number>;
  noBids: Record<string, number>;
};

const jsonHeaders = {
  "Content-Type": "application/json",
  "x-api-key": env.DFLOW_API_KEY
};

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function toNumber(value: number | string | undefined | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toTsDate(value: number | string | undefined): Date | undefined {
  const numeric = toNumber(value);
  if (!numeric) {
    return undefined;
  }

  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeMarket(item: DflowMarketApi): DflowMarket {
  const marketTicker = String(item.ticker ?? item.marketTicker ?? item.id ?? "");
  const eventTicker = String(item.eventTicker ?? item.event_ticker ?? "UNKNOWN");
  const yesBid = toNumber(item.yesBid ?? item.yes_bid);
  const yesAsk = toNumber(item.yesAsk ?? item.yes_ask);
  const noBid = toNumber(item.noBid ?? item.no_bid);
  const noAsk = toNumber(item.noAsk ?? item.no_ask);

  const yesPrice = yesBid > 0 && yesAsk > 0 ? (yesBid + yesAsk) / 2 : yesBid || yesAsk;
  const noPrice = noBid > 0 && noAsk > 0 ? (noBid + noAsk) / 2 : noBid || noAsk;

  return {
    id: marketTicker,
    marketTicker,
    eventTicker,
    title: item.title,
    subtitle: item.subtitle,
    status: item.status,
    closeTime: toTsDate(item.closeTime ?? item.close_time ?? item.endDate),
    yesPrice,
    noPrice,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    volume24h: toNumber(item.volume24h ?? item.volume_24h ?? item.dayVolume),
    openInterest: toNumber(item.openInterest ?? item.open_interest),
    raw: item
  };
}

function normalizeTrade(item: DflowTradeApi): DflowTrade {
  const yesPriceDollars = toNumber(item.yesPriceDollars ?? item.yes_price_dollars) || toNumber(item.yesPrice) / 10000;
  const noPriceDollars = toNumber(item.noPriceDollars ?? item.no_price_dollars) || toNumber(item.noPrice) / 10000;
  const count = toNumber(item.count);
  const midpoint =
    yesPriceDollars > 0 && noPriceDollars > 0 ? (yesPriceDollars + noPriceDollars) / 2 : Math.max(yesPriceDollars, noPriceDollars, 0);
  const takerSideRaw = String(item.takerSide ?? item.taker_side ?? "").toUpperCase();

  return {
    tradeId: String(item.tradeId ?? item.trade_id ?? crypto.randomUUID()),
    marketTicker: String(item.ticker ?? item.marketTicker ?? item.market_ticker ?? ""),
    createdTime: toTsDate(item.createdTime ?? item.created_time) ?? new Date(),
    takerSide: takerSideRaw === "YES" ? "YES" : takerSideRaw === "NO" ? "NO" : "UNKNOWN",
    count,
    yesPriceDollars,
    noPriceDollars,
    notionalUsdEst: midpoint * count
  };
}

function normalizeOrderbookSide(side: Record<string, number | string> | undefined): Record<string, number> {
  if (!side) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [price, size] of Object.entries(side)) {
    normalized[price] = toNumber(size);
  }

  return normalized;
}

function normalizeOrderbook(ticker: string, payload: DflowOrderbookApi): DflowOrderbook {
  return {
    marketTicker: ticker,
    sequence: toNumber(payload.sequence) || null,
    yesBids: normalizeOrderbookSide(payload.yes_bids),
    noBids: normalizeOrderbookSide(payload.no_bids)
  };
}

function toMarketRecords(payload: DflowMarketsResponse | DflowMarketApi[] | null): DflowMarketApi[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload?.markets && Array.isArray(payload.markets)) {
    return payload.markets;
  }

  return [];
}

function toTradeRecords(payload: DflowTradesResponse | DflowTradeApi[] | null): DflowTradeApi[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload?.trades && Array.isArray(payload.trades)) {
    return payload.trades;
  }

  return [];
}

function toTradeCursor(payload: DflowTradesResponse | DflowTradeApi[] | null): string | null {
  if (!payload || Array.isArray(payload)) {
    return null;
  }

  return typeof payload.cursor === "string" && payload.cursor.length > 0 ? payload.cursor : null;
}

export class DflowClient {
  constructor(
    private readonly apiBaseUrl = env.DFLOW_API_BASE_URL,
    private readonly pondBaseUrl = env.DFLOW_POND_BASE_URL
  ) {}

  async listMarkets(limit = 50): Promise<DflowMarket[]> {
    const pondUrl = `${this.pondBaseUrl}/api/v1/markets?limit=${limit}`;
    logger.info({ limit, pondUrl }, "dflow listMarkets request");
    const pondResponse = await fetch(pondUrl, { headers: jsonHeaders });

    if (pondResponse.ok) {
      const pondPayload = await safeJson<DflowMarketsResponse | DflowMarketApi[]>(pondResponse);
      const markets = toMarketRecords(pondPayload)
        .map(normalizeMarket)
        .filter((market) => market.marketTicker.length > 0);
      logger.info({ count: markets.length, source: "pond" }, "dflow listMarkets success");
      return markets;
    }

    const apiUrl = `${this.apiBaseUrl}/v1/markets?limit=${limit}`;
    const apiResponse = await fetch(apiUrl, { headers: jsonHeaders });

    if (!apiResponse.ok) {
      const errorPayload = await safeJson<Record<string, string>>(apiResponse);
      logger.error(
        { status: apiResponse.status, source: "api", payload: JSON.stringify(errorPayload) },
        "dflow listMarkets failed"
      );
      throw new Error(
        `Unable to fetch markets from dFlow. Status=${apiResponse.status}. Payload=${JSON.stringify(errorPayload)}`
      );
    }

    const payload = await safeJson<DflowMarketsResponse | DflowMarketApi[]>(apiResponse);
    const markets = toMarketRecords(payload)
      .map(normalizeMarket)
      .filter((market) => market.marketTicker.length > 0);
    logger.info({ count: markets.length, source: "api" }, "dflow listMarkets success");
    return markets;
  }

  async getMarketByTicker(marketTicker: string): Promise<DflowMarket | null> {
    const url = `${this.apiBaseUrl}/api/v1/market/${encodeURIComponent(marketTicker)}`;
    logger.debug({ marketTicker, url }, "dflow getMarketByTicker request");
    const response = await fetch(url, { headers: jsonHeaders });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const payload = await safeJson<Record<string, string>>(response);
      throw new Error(
        `Unable to fetch market ${marketTicker}. Status=${response.status}. Payload=${JSON.stringify(payload)}`
      );
    }

    const payload = await safeJson<DflowMarketApi>(response);
    if (!payload) {
      return null;
    }

    return normalizeMarket(payload);
  }

  async listTrades(params: {
    marketTicker?: string;
    minTs?: number;
    maxTs?: number;
    limit?: number;
    cursor?: string;
  }): Promise<DflowTrade[]> {
    const query = new URLSearchParams();
    if (params.marketTicker) {
      query.set("ticker", params.marketTicker);
    }
    query.set("limit", String(params.limit ?? 200));
    if (typeof params.minTs === "number") {
      query.set("minTs", String(params.minTs));
    }
    if (typeof params.maxTs === "number") {
      query.set("maxTs", String(params.maxTs));
    }
    if (typeof params.cursor === "string" && params.cursor.length > 0) {
      query.set("cursor", params.cursor);
    }

    const url = `${this.pondBaseUrl}/api/v1/trades?${query.toString()}`;
    logger.debug({ marketTicker: params.marketTicker ?? "ALL", url }, "dflow listTrades request");
    const response = await fetch(url, { headers: jsonHeaders });

    if (!response.ok) {
      const payload = await safeJson<Record<string, string>>(response);
      logger.warn(
        {
          marketTicker: params.marketTicker,
          status: response.status,
          payload: JSON.stringify(payload)
        },
        "dflow listTrades failed"
      );
      throw new Error(
        `Unable to fetch trades for ${params.marketTicker ?? "ALL"}. Status=${response.status}. Payload=${JSON.stringify(payload)}`
      );
    }

    const payload = await safeJson<DflowTradesResponse | DflowTradeApi[]>(response);
    const trades = toTradeRecords(payload).map(normalizeTrade);
    logger.debug({ marketTicker: params.marketTicker ?? "ALL", count: trades.length }, "dflow listTrades success");
    return trades;
  }

  async listTradesPage(params: {
    marketTicker?: string;
    minTs?: number;
    maxTs?: number;
    limit?: number;
    cursor?: string;
  }): Promise<{ trades: DflowTrade[]; cursor: string | null }> {
    const query = new URLSearchParams();
    if (params.marketTicker) {
      query.set("ticker", params.marketTicker);
    }
    query.set("limit", String(params.limit ?? 500));
    if (typeof params.minTs === "number") {
      query.set("minTs", String(params.minTs));
    }
    if (typeof params.maxTs === "number") {
      query.set("maxTs", String(params.maxTs));
    }
    if (typeof params.cursor === "string" && params.cursor.length > 0) {
      query.set("cursor", params.cursor);
    }

    const url = `${this.pondBaseUrl}/api/v1/trades?${query.toString()}`;
    logger.debug({ marketTicker: params.marketTicker ?? "ALL", url }, "dflow listTradesPage request");
    const response = await fetch(url, { headers: jsonHeaders });

    if (!response.ok) {
      const payload = await safeJson<Record<string, string>>(response);
      throw new Error(
        `Unable to fetch trades page for ${params.marketTicker ?? "ALL"}. Status=${response.status}. Payload=${JSON.stringify(payload)}`
      );
    }

    const payload = await safeJson<DflowTradesResponse | DflowTradeApi[]>(response);
    return {
      trades: toTradeRecords(payload).map(normalizeTrade),
      cursor: toTradeCursor(payload)
    };
  }

  async listTradesInWindowAll(params: {
    minTs: number;
    maxTs: number;
    pageSize?: number;
    maxPages?: number;
  }): Promise<DflowTrade[]> {
    const pageSize = params.pageSize ?? 500;
    const maxPages = params.maxPages ?? 100;
    const all: DflowTrade[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const batch = await this.listTradesPage({
        minTs: params.minTs,
        maxTs: params.maxTs,
        limit: pageSize,
        cursor
      });

      all.push(...batch.trades.filter((trade) => trade.createdTime.getTime() >= params.minTs * 1000));

      if (!batch.cursor || batch.trades.length === 0) {
        break;
      }

      const oldestTrade = batch.trades.reduce((oldest, trade) =>
        trade.createdTime.getTime() < oldest.getTime() ? trade.createdTime : oldest
      , batch.trades[0].createdTime);

      cursor = batch.cursor;

      if (oldestTrade.getTime() < params.minTs * 1000) {
        break;
      }
    }

    return all;
  }

  async getOrderbook(marketTicker: string): Promise<DflowOrderbook> {
    const url = `${this.pondBaseUrl}/api/v1/orderbook/${encodeURIComponent(marketTicker)}`;
    logger.debug({ marketTicker, url }, "dflow getOrderbook request");
    const response = await fetch(url, { headers: jsonHeaders });

    if (!response.ok) {
      const payload = await safeJson<Record<string, string>>(response);
      logger.warn({ marketTicker, status: response.status, payload: JSON.stringify(payload) }, "dflow getOrderbook failed");
      throw new Error(
        `Unable to fetch orderbook for ${marketTicker}. Status=${response.status}. Payload=${JSON.stringify(payload)}`
      );
    }

    const payload = await safeJson<DflowOrderbookApi>(response);
    const orderbook = normalizeOrderbook(marketTicker, payload ?? {});
    logger.debug({ marketTicker, levelsYes: Object.keys(orderbook.yesBids).length, levelsNo: Object.keys(orderbook.noBids).length }, "dflow getOrderbook success");
    return orderbook;
  }
}
