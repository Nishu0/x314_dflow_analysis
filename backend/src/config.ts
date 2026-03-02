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
  DFLOW_API_BASE_URL: z.string().url().default("https://api.dflow.net"),
  DFLOW_POND_BASE_URL: z.string().url().default("https://pond.dflow.net")
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  DFLOW_API_KEY: process.env.DFLOW_API_KEY,
  DFLOW_API_BASE_URL: process.env.DFLOW_API_BASE_URL,
  DFLOW_POND_BASE_URL: process.env.DFLOW_POND_BASE_URL
});
