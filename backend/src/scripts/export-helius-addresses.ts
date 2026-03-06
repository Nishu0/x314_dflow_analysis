import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { marketAccounts, markets } from "../db/schema";

const marketLimit = Number(process.argv[2] ?? "250");
const includeLedger = (process.argv[3] ?? "true").toLowerCase() !== "false";
const webhookUrl = process.argv[4] ?? "https://YOUR-NGROK-URL.ngrok-free.app/webhooks/helius";

const marketRows = await db
  .select({ marketTicker: markets.marketTicker })
  .from(markets)
  .where(eq(markets.status, "active"))
  .orderBy(desc(markets.lastSeenAt))
  .limit(marketLimit);

const tickers = marketRows.map((row) => row.marketTicker);
const accountRows = await db
  .select()
  .from(marketAccounts)
  .orderBy(desc(marketAccounts.updatedAt));

const tickerSet = new Set(tickers);
const addresses = new Set<string>();
for (const row of accountRows) {
  if (!tickerSet.has(row.marketTicker)) {
    continue;
  }
  addresses.add(row.yesMint);
  addresses.add(row.noMint);
  if (includeLedger) {
    addresses.add(row.marketLedger);
  }
}

const payload = {
  webhookURL: webhookUrl,
  webhookType: "enhanced",
  transactionTypes: ["ANY"],
  txnStatus: "all",
  accountAddresses: [...addresses]
};

console.log(JSON.stringify({
  marketLimit,
  includeLedger,
  marketsSelected: tickers.length,
  addressCount: payload.accountAddresses.length,
  payload
}, null, 2));
