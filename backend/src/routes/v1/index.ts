import { Elysia } from "elysia";
import { v1MarketRoutes } from "./markets";
import { v1PlatformRoutes } from "./platform";
import { v1TradeRoutes } from "./trades";
import { v1WalletRoutes } from "./wallets";

// Base URL (local):  http://localhost:3000/api/v1
// Base URL (deploy): Replace with production URL when deploying

export const v1Routes = new Elysia({ prefix: "/api/v1" })
  .use(v1MarketRoutes)
  .use(v1PlatformRoutes)
  .use(v1TradeRoutes)
  .use(v1WalletRoutes)
  .get("/", () => ({
    version: "v1",
    baseUrl: "http://localhost:3000/api/v1",
    endpoints: {
      markets: {
        trending: "GET /api/v1/markets/trending?windowHours=24&limit=20",
        search: "GET /api/v1/markets/search?q=&status=active&closingIn=week&category=",
        categories: "GET /api/v1/markets/categories?windowHours=24",
        priceHistory: "GET /api/v1/markets/price-history?marketTicker=&windowHours=24",
        intelligence: "POST /api/v1/markets/intelligence  body: {marketTicker, windowHours?}",
        sentiment: "POST /api/v1/markets/sentiment  body: {marketTicker, windowHours?, bucketHours?}",
        participants: "POST /api/v1/markets/participants  body: {marketTicker, windowHours?}",
        insiders: "POST /api/v1/markets/insiders  body: {marketTicker, windowHours?}",
        trades: "GET /api/v1/markets/trades?marketTicker=&windowHours=24&limit=100",
        similar: "GET /api/v1/markets/similar?marketTicker=&windowHours=168&limit=10",
        opportunities: "GET /api/v1/markets/opportunities?windowHours=24&limit=20",
        highConviction: "GET /api/v1/markets/high-conviction?windowHours=24&limit=20&minWallets=2",
        capitalFlow: "GET /api/v1/markets/capital-flow?windowHours=24",
        volumeHeatmap: "GET /api/v1/markets/volume-heatmap?windowHours=168",
        resolutions: "GET /api/v1/markets/resolutions?limit=50&windowHours=720",
        dumbMoney: "GET /api/v1/markets/dumb-money?windowHours=24&limit=20"
      },
      platform: {
        stats: "GET /api/v1/platform/stats?windowHours=24"
      },
      trades: {
        whales: "GET /api/v1/trades/whales?windowHours=24&minUsd=1000&limit=50"
      },
      wallets: {
        profile: "POST /api/v1/wallets/profile  body: {walletAddress, windowHours?}",
        activity: "POST /api/v1/wallets/activity  body: {walletAddress, windowHours?, limit?}",
        pnlBreakdown: "POST /api/v1/wallets/pnl-breakdown  body: {walletAddress}",
        compare: "POST /api/v1/wallets/compare  body: {walletAddresses: string[], windowHours?}",
        copyTraders: "POST /api/v1/wallets/copy-traders  body: {walletAddress, windowHours?, maxLagHours?}",
        topPerformers: "GET /api/v1/wallets/top-performers?limit=50&sortBy=qualityScore",
        nicheExperts: "GET /api/v1/wallets/niche-experts?category=&limit=20&windowHours=168",
        alphaCallers: "GET /api/v1/wallets/alpha-callers?limit=20&windowHours=336",
        insiders: "GET /api/v1/wallets/insiders?windowHours=168&limit=30"
      }
    }
  }));
