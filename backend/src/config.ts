import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z
    .string()
    .default("3000")
    .transform((value) => Number(value))
    .pipe(z.number().int().positive()),
  DFLOW_API_KEY: z.string().min(1, "DFLOW_API_KEY is required"),
  DFLOW_API_BASE_URL: z.string().url().default("https://d.prediction-markets-api.dflow.net"),
  DFLOW_POND_BASE_URL: z.string().url().default("https://d.prediction-markets-api.dflow.net"),
  SOLANA_RPC_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  ANALYSIS_QUEUE_NAME: z.string().default("analysis-tick"),
  ANALYSIS_INTERVAL_MS: z
    .string()
    .default("60000")
    .transform((value) => Number(value))
    .pipe(z.number().int().positive()),
  ANALYSIS_MARKET_LIMIT: z
    .string()
    .default("200")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(1000)),
  ANALYSIS_GLOBAL_TRADE_LIMIT: z
    .string()
    .default("3000")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(100).max(20000)),
  ANALYSIS_WINDOW_HOURS: z
    .string()
    .default("24")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(168)),
  WALLET_SOL_USD_ESTIMATE: z
    .string()
    .default("150")
    .transform((value) => Number(value))
    .pipe(z.number().positive()),
  WALLET_PYTH_HERMES_URL: z
    .string()
    .url()
    .default("https://hermes.pyth.network"),
  WALLET_SOL_USD_FEED_ID: z
    .string()
    .default("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"),
  WALLET_SOL_PRICE_TTL_MS: z
    .string()
    .default("60000")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(5000).max(3600000)),
  LARGE_ORDER_MIN_USD: z
    .string()
    .default("1000")
    .transform((value) => Number(value))
    .pipe(z.number().positive()),
  TAG_MIN_ORDER_USD: z
    .string()
    .default("3000")
    .transform((value) => Number(value))
    .pipe(z.number().positive()),
  WHALE_MIN_BALANCE_USD: z
    .string()
    .default("30000")
    .transform((value) => Number(value))
    .pipe(z.number().positive()),
  INSIDER_MAX_ACCOUNT_AGE_DAYS: z
    .string()
    .default("30")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(3650)),
  RPC_POLL_MARKET_LIMIT: z
    .string()
    .default("300")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(10).max(5000)),
  RPC_POLL_SIGNATURE_LIMIT: z
    .string()
    .default("25")
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(1000)),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  DFLOW_API_KEY: process.env.DFLOW_API_KEY,
  DFLOW_API_BASE_URL: process.env.DFLOW_API_BASE_URL,
  DFLOW_POND_BASE_URL: process.env.DFLOW_POND_BASE_URL,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  ANALYSIS_QUEUE_NAME: process.env.ANALYSIS_QUEUE_NAME,
  ANALYSIS_INTERVAL_MS: process.env.ANALYSIS_INTERVAL_MS,
  ANALYSIS_MARKET_LIMIT: process.env.ANALYSIS_MARKET_LIMIT,
  ANALYSIS_GLOBAL_TRADE_LIMIT: process.env.ANALYSIS_GLOBAL_TRADE_LIMIT,
  ANALYSIS_WINDOW_HOURS: process.env.ANALYSIS_WINDOW_HOURS,
  WALLET_SOL_USD_ESTIMATE: process.env.WALLET_SOL_USD_ESTIMATE,
  WALLET_PYTH_HERMES_URL: process.env.WALLET_PYTH_HERMES_URL,
  WALLET_SOL_USD_FEED_ID: process.env.WALLET_SOL_USD_FEED_ID,
  WALLET_SOL_PRICE_TTL_MS: process.env.WALLET_SOL_PRICE_TTL_MS,
  LARGE_ORDER_MIN_USD: process.env.LARGE_ORDER_MIN_USD,
  TAG_MIN_ORDER_USD: process.env.TAG_MIN_ORDER_USD,
  WHALE_MIN_BALANCE_USD: process.env.WHALE_MIN_BALANCE_USD,
  INSIDER_MAX_ACCOUNT_AGE_DAYS: process.env.INSIDER_MAX_ACCOUNT_AGE_DAYS,
  RPC_POLL_MARKET_LIMIT: process.env.RPC_POLL_MARKET_LIMIT,
  RPC_POLL_SIGNATURE_LIMIT: process.env.RPC_POLL_SIGNATURE_LIMIT,
  LOG_LEVEL: process.env.LOG_LEVEL
});
