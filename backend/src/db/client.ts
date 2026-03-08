import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config";
import * as schema from "./schema";

// Strip sslmode from URL and pass ssl config explicitly so cert verification can be
// disabled for Aiven and other hosted DBs that use self-signed certificate chains.
const dbUrl = env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, (match) =>
  match.startsWith("?") ? "?" : ""
).replace(/\?$/, "");
const needsSsl = env.DATABASE_URL.includes("sslmode=");

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined
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
