import { Queue, QueueEvents, Worker } from "bullmq";
import { env } from "../config";
import { DflowClient, type DflowMarket, type DflowTrade } from "../lib/dflow-client";
import { logger } from "../lib/pino";
import { ingestMarketWindow } from "../services/ingestion/market-ingestion";
import { runWalletProcessor } from "../services/pipeline/wallet-processor";
import {
  createOrGetAnalysisRun,
  getLatestSuccessfulRun,
  markAnalysisRunFailed,
  markAnalysisRunRunning,
  markAnalysisRunSucceeded
} from "../services/analysis-runs-repository";
import { createRpcAttribution } from "../services/wallet/rpc-attribution";
import { pollRpcAttributionsForMarketAccounts } from "../services/wallet/rpc-signature-poller";

const redisConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null
};

const dflowClient = new DflowClient();
const MAX_ATTRIBUTION_ATTEMPTS_PER_TICK = 120;

const runtimeState = {
  queueName: env.ANALYSIS_QUEUE_NAME,
  lastCompletedAt: null as string | null,
  lastFailedAt: null as string | null,
  lastError: null as string | null,
  totalCompleted: 0,
  totalFailed: 0,
  lastRunDurationMs: null as number | null,
  lastMarketsScanned: 0,
  lastMarketsScored: 0
};

export async function getAnalysisRuntimeHealth(): Promise<{
  queueName: string;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  latestSuccessfulRunId: string | null;
  totalCompleted: number;
  totalFailed: number;
  lastRunDurationMs: number | null;
  lastMarketsScanned: number;
  lastMarketsScored: number;
}> {
  const latestRun = await getLatestSuccessfulRun();
  return {
    queueName: runtimeState.queueName,
    lastCompletedAt: runtimeState.lastCompletedAt,
    lastFailedAt: runtimeState.lastFailedAt,
    lastError: runtimeState.lastError,
    latestSuccessfulRunId: latestRun?.runId ?? null,
    totalCompleted: runtimeState.totalCompleted,
    totalFailed: runtimeState.totalFailed,
    lastRunDurationMs: runtimeState.lastRunDurationMs,
    lastMarketsScanned: runtimeState.lastMarketsScanned,
    lastMarketsScored: runtimeState.lastMarketsScored
  };
}

type AnalysisTickPayload = {
  scheduledFor: string;
};

function floorToMinute(date: Date): Date {
  const value = new Date(date);
  value.setUTCSeconds(0, 0);
  return value;
}

function toRunId(scheduledFor: Date): string {
  return `run_${scheduledFor.toISOString().replace(/[-:.]/g, "")}`;
}

function asErrorMessage(error: Error | string | number | boolean | object | null | undefined): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return String(error);
}

function isAnalyzableMarket(market: DflowMarket): boolean {
  const status = (market.status ?? "").toLowerCase();
  if (status !== "active" && status !== "initialized") {
    return false;
  }

  return true;
}

function looksLikeSolanaSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
}

async function executeAnalysisTick(payload: AnalysisTickPayload, attempt: number): Promise<void> {
  const runStartedAt = Date.now();
  const scheduledFor = floorToMinute(new Date(payload.scheduledFor));
  const idempotencyKey = `analysis:${scheduledFor.toISOString()}`;
  const runId = toRunId(scheduledFor);
  const run = await createOrGetAnalysisRun({
    runId,
    idempotencyKey,
    scheduledFor,
    attempt
  });

  if (run.status === "SUCCEEDED") {
    logger.info({ runId: run.runId, scheduledFor: scheduledFor.toISOString() }, "analysis run already succeeded");
    return;
  }

  const workerId = `${process.pid}`;
  await markAnalysisRunRunning(run.runId, workerId);
  logger.info(
    {
      runId: run.runId,
      scheduledFor: scheduledFor.toISOString(),
      attempt,
      workerId
    },
    "analysis run started"
  );

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - env.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);
    const windowEndEpochSec = Math.floor(now.getTime() / 1000);

    const oneMinuteStartEpochSec = Math.floor((now.getTime() - 60 * 1000) / 1000);
    const allRecentTrades = await dflowClient.listTradesInWindowAll({
      minTs: oneMinuteStartEpochSec,
      maxTs: windowEndEpochSec,
      pageSize: Math.min(1000, env.ANALYSIS_GLOBAL_TRADE_LIMIT),
      maxPages: Math.max(1, Math.ceil(env.ANALYSIS_GLOBAL_TRADE_LIMIT / 1000))
    });

    const totalRecentNotionalUsd = allRecentTrades.reduce((acc, trade) => acc + Number(trade.notionalUsdEst ?? 0), 0);
    const largeOrders = allRecentTrades
      .filter((trade) => Number(trade.notionalUsdEst ?? 0) >= env.LARGE_ORDER_MIN_USD)
      .sort((left, right) => Number(right.notionalUsdEst ?? 0) - Number(left.notionalUsdEst ?? 0));
    const largeOrderSamples = largeOrders.slice(0, 8).map((trade) => ({
      tradeId: trade.tradeId,
      marketTicker: trade.marketTicker,
      side: trade.takerSide,
      notionalUsdEst: Number(Number(trade.notionalUsdEst ?? 0).toFixed(2)),
      createdTime: trade.createdTime.toISOString()
    }));

    logger.info(
      {
        runId: run.runId,
        tradeWindowStart: new Date(oneMinuteStartEpochSec * 1000).toISOString(),
        tradeWindowEnd: new Date(windowEndEpochSec * 1000).toISOString(),
        totalTradesFetched: allRecentTrades.length,
        totalRecentNotionalUsd: Number(totalRecentNotionalUsd.toFixed(2)),
        largeOrderMinUsd: env.LARGE_ORDER_MIN_USD,
        largeOrderCount: largeOrders.length,
        largeOrderSamples
      },
      "queue trade data snapshot"
    );

    const recentTradesByMarket = new Map<string, DflowTrade[]>();
    for (const trade of allRecentTrades) {
      const list = recentTradesByMarket.get(trade.marketTicker) ?? [];
      list.push(trade);
      recentTradesByMarket.set(trade.marketTicker, list);
    }

    const tradedTickers = new Set([...recentTradesByMarket.keys()].filter((ticker) => ticker.length > 0));
    const largeOrderByMarket = new Map<string, number>();
    for (const [ticker, trades] of recentTradesByMarket.entries()) {
      const largeOrderCount = trades.filter((trade) => trade.notionalUsdEst >= env.LARGE_ORDER_MIN_USD).length;
      if (largeOrderCount > 0) {
        largeOrderByMarket.set(ticker, largeOrderCount);
      }
    }
    const candidateTickers = new Set(largeOrderByMarket.keys());
    const candidateMarketSamples = [...largeOrderByMarket.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([marketTicker, largeOrderCount]) => ({ marketTicker, largeOrderCount }));

    logger.info(
      {
        runId: run.runId,
        oneMinuteTrades: allRecentTrades.length,
        tradedMarkets: tradedTickers.size,
        largeOrderMarkets: candidateTickers.size,
        candidateMarketSamples
      },
      "global trades fetched"
    );

    const metadataTickerSet = new Set<string>([...candidateTickers, ...tradedTickers]);
    const candidateList = [...metadataTickerSet].slice(0, env.ANALYSIS_MARKET_LIMIT);
    const fetchedMarkets = await Promise.all(
      candidateList.map(async (ticker) => dflowClient.getMarketByTicker(ticker))
    );

    const allMarkets = fetchedMarkets.filter((market) => market !== null);
    const markets = allMarkets.filter((market) => isAnalyzableMarket(market));
    const skippedMarkets = candidateList.length - markets.length;
    const marketFetchSamples = markets.slice(0, 12).map((market) => ({
      marketTicker: market.marketTicker,
      eventTicker: market.eventTicker,
      status: market.status,
      yesBid: market.yesBid ?? null,
      yesAsk: market.yesAsk ?? null,
      noBid: market.noBid ?? null,
      noAsk: market.noAsk ?? null
    }));

    logger.info(
      {
        runId: run.runId,
        metadataMarkets: candidateList.length,
        marketsFetched: allMarkets.length,
        marketsSelected: markets.length,
        skippedMarkets,
        marketsWithRecentTrades: tradedTickers.size,
        marketsWithLargeOrders: candidateTickers.size,
        marketFetchSamples
      },
      "markets fetched"
    );

    if (markets.length === 0) {
      await markAnalysisRunSucceeded({
        runId: run.runId,
        marketsScanned: 0,
        marketsScored: 0,
        inputWindowStart: windowStart,
        inputWindowEnd: now
      });

      runtimeState.lastRunDurationMs = Date.now() - runStartedAt;
      runtimeState.lastMarketsScanned = 0;
      runtimeState.lastMarketsScored = 0;
      logger.warn({ runId: run.runId }, "no analyzable markets for this tick");
      return;
    }

    await ingestMarketWindow({
      markets,
      globalTradesByMarket: recentTradesByMarket,
      runAt: now,
    });
    logger.info({ runId: run.runId, marketsIngested: markets.length }, "market window ingested");

    const selectedMarketTickers = new Set(markets.map((market) => market.marketTicker));
    const candidateTradesForAttribution = allRecentTrades
      .filter(
        (trade) =>
          selectedMarketTickers.has(trade.marketTicker) &&
          trade.marketTicker.length > 0 &&
          Number(trade.notionalUsdEst ?? 0) >= env.LARGE_ORDER_MIN_USD &&
          trade.tradeId.length > 0
      )
      .sort((left, right) => Number(right.notionalUsdEst ?? 0) - Number(left.notionalUsdEst ?? 0));

    const attributionCandidates = candidateTradesForAttribution
      .filter((trade) => looksLikeSolanaSignature(trade.tradeId))
      .slice(0, MAX_ATTRIBUTION_ATTEMPTS_PER_TICK);

    const skippedNonSignatureTrades = candidateTradesForAttribution.length - attributionCandidates.length;

    const attributionResults = await Promise.allSettled(
      attributionCandidates.map(async (trade) => {
        const side = trade.takerSide === "YES" || trade.takerSide === "NO" ? trade.takerSide : undefined;
        return createRpcAttribution({
          signature: trade.tradeId,
          marketTicker: trade.marketTicker,
          side,
          sizeUsdEst: Number(trade.notionalUsdEst ?? 0)
        });
      })
    );

    const attributionSuccessCount = attributionResults.filter((result) => result.status === "fulfilled").length;
    const attributionFailureSamples = attributionResults
      .map((result, index) => {
        if (result.status === "fulfilled") {
          return null;
        }
        const trade = attributionCandidates[index];
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        return {
          tradeId: trade.tradeId,
          marketTicker: trade.marketTicker,
          notionalUsdEst: Number(Number(trade.notionalUsdEst ?? 0).toFixed(2)),
          reason
        };
      })
      .filter((row): row is { tradeId: string; marketTicker: string; notionalUsdEst: number; reason: string } => row !== null)
      .slice(0, 10);

    logger.info(
      {
        runId: run.runId,
        candidateTradesForAttribution: candidateTradesForAttribution.length,
        attributionCandidates: attributionCandidates.length,
        skippedNonSignatureTrades,
        attributionSuccessCount,
        attributionFailureCount: attributionCandidates.length - attributionSuccessCount,
        attributionFailureSamples
      },
      "rpc attribution enqueue and execution completed"
    );

    const rpcPollStats = await pollRpcAttributionsForMarketAccounts({
      candidateTickers: markets.map((market) => market.marketTicker)
    });
    logger.info(
      {
        runId: run.runId,
        ...rpcPollStats
      },
      "rpc market-account attribution polling completed"
    );

    const walletResults = await runWalletProcessor({
      candidateTickers: markets.map((market) => market.marketTicker),
      highVolumeByMarket: largeOrderByMarket,
      windowStart
    });
    const snapshotTime = new Date();
    const taggedMarketCount = [...walletResults.values()].filter(
      (result) => result.signalType === "INSIDER" || result.signalType === "WHALE"
    ).length;
    const signalBreakdown = [...walletResults.values()].reduce(
      (acc, row) => {
        if (row.signalType === "INSIDER") {
          acc.insider += 1;
        } else if (row.signalType === "WHALE") {
          acc.whale += 1;
        } else if (row.signalType === "PENDING") {
          acc.pending += 1;
        } else {
          acc.none += 1;
        }
        return acc;
      },
      { insider: 0, whale: 0, pending: 0, none: 0 }
    );
    const walletSignalSamples = [...walletResults.values()]
      .filter((row) => row.signalType !== "NONE")
      .slice(0, 16)
      .map((row) => ({
        marketTicker: row.marketTicker,
        signalType: row.signalType,
        signalConfidence: row.signalConfidence,
        signalWalletAddress: row.signalWalletAddress,
        coverageCount: row.coverageCount,
        dominantSide: row.dominantSide,
        reason: row.signalReason
      }));
    logger.info(
      {
        runId: run.runId,
        marketsProcessed: markets.length,
        taggedMarkets: taggedMarketCount,
        signalBreakdown,
        walletSignalSamples
      },
      "wallet-first pipeline computed"
    );

    await markAnalysisRunSucceeded({
      runId: run.runId,
      marketsScanned: markets.length,
      marketsScored: taggedMarketCount,
      inputWindowStart: new Date(snapshotTime.getTime() - env.ANALYSIS_INTERVAL_MS),
      inputWindowEnd: snapshotTime
    });

    runtimeState.lastRunDurationMs = Date.now() - runStartedAt;
    runtimeState.lastMarketsScanned = markets.length;
    runtimeState.lastMarketsScored = taggedMarketCount;
    logger.info(
      {
        runId: run.runId,
        durationMs: runtimeState.lastRunDurationMs,
        marketsScanned: markets.length,
        marketsScored: taggedMarketCount
      },
      "analysis run succeeded"
    );
  } catch (error) {
    const message = asErrorMessage(error as Error | string | number | boolean | object | null | undefined);
    await markAnalysisRunFailed(
      run.runId,
      message
    );
    logger.error({ runId: run.runId, attempt, error: message }, "analysis run failed");
    throw error;
  }
}

export async function startAnalysisRuntime(): Promise<() => Promise<void>> {
  logger.info(
    {
      queue: env.ANALYSIS_QUEUE_NAME,
      intervalMs: env.ANALYSIS_INTERVAL_MS,
      redisUrl: env.REDIS_URL
    },
    "starting analysis runtime"
  );

  const queue = new Queue(env.ANALYSIS_QUEUE_NAME, {
    connection: redisConnection
  });
  const queueEvents = new QueueEvents(env.ANALYSIS_QUEUE_NAME, {
    connection: redisConnection
  });

  const repeatJob = await queue.add(
    "analysis_tick",
    {
      scheduledFor: floorToMinute(new Date()).toISOString()
    },
    {
      jobId: "analysis_tick_every_minute",
      repeat: {
        every: env.ANALYSIS_INTERVAL_MS
      },
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000
      },
      removeOnComplete: 200,
      removeOnFail: 500
    }
  );
  logger.info({ queue: env.ANALYSIS_QUEUE_NAME, repeatJobId: repeatJob.id }, "analysis repeat job ensured");

  const worker = new Worker<AnalysisTickPayload>(
    env.ANALYSIS_QUEUE_NAME,
    async (job) => {
      logger.info(
        {
          jobId: job.id,
          attemptsStarted: job.attemptsStarted,
          timestamp: job.timestamp,
          name: job.name
        },
        "analysis worker picked job"
      );
      const scheduledFor = floorToMinute(new Date(job.timestamp)).toISOString();
      await executeAnalysisTick({ scheduledFor }, job.attemptsStarted || 1);
    },
    {
      connection: redisConnection,
      concurrency: 1
    }
  );

  worker.on("failed", (job, error) => {
    const errorMessage = asErrorMessage(error as Error | object | string);
    runtimeState.lastFailedAt = new Date().toISOString();
    runtimeState.lastError = errorMessage;
    runtimeState.totalFailed += 1;
    logger.error({
      jobId: job?.id,
      queue: env.ANALYSIS_QUEUE_NAME,
      error: errorMessage
    }, "analysis job failed");
  });

  worker.on("completed", (job) => {
    runtimeState.lastCompletedAt = new Date().toISOString();
    runtimeState.lastError = null;
    runtimeState.totalCompleted += 1;
    logger.info({
      jobId: job.id,
      queue: env.ANALYSIS_QUEUE_NAME
    }, "analysis job completed");
  });

  worker.on("active", (job) => {
    logger.info({ jobId: job.id, queue: env.ANALYSIS_QUEUE_NAME }, "analysis job active");
  });

  worker.on("error", (error) => {
    logger.error({ error: asErrorMessage(error) }, "analysis worker error");
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    logger.error({ jobId, failedReason }, "analysis queue event failed");
  });

  queueEvents.on("completed", ({ jobId }) => {
    logger.info({ jobId }, "analysis queue event completed");
  });

  logger.info({ queue: env.ANALYSIS_QUEUE_NAME }, "analysis worker and queue events ready");

  return async () => {
    logger.warn({ queue: env.ANALYSIS_QUEUE_NAME }, "stopping analysis runtime");
    await worker.close();
    await queueEvents.close();
    await queue.close();
    logger.info({ queue: env.ANALYSIS_QUEUE_NAME }, "analysis runtime stopped");
  };
}
