import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

export const db = drizzle(pool, { schema });

export type DbClient = typeof db;

let closePromise: Promise<void> | null = null;
let isPoolClosed = false;

export async function closeDbPool(): Promise<void> {
  if (isPoolClosed) {
    return;
  }

  if (closePromise) {
    await closePromise;
    return;
  }

  closePromise = pool.end().then(() => {
    isPoolClosed = true;
  });

  await closePromise;
}
