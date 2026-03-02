import { Elysia, t } from "elysia";
import { DflowClient } from "../lib/dflow-client";
import { rankSignals } from "../services/analysis";

const dflowClient = new DflowClient();

export const marketRoutes = new Elysia({ prefix: "/markets" })
  .get(
    "/raw",
    async ({ query }) => {
      const limit = query.limit ?? 50;
      const markets = await dflowClient.listMarkets(limit);

      return {
        count: markets.length,
        markets
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 }))
      })
    }
  )
  .get(
    "/convictions",
    async ({ query }) => {
      const limit = query.limit ?? 100;
      const markets = await dflowClient.listMarkets(limit);
      const signals = rankSignals(markets);

      return {
        count: signals.length,
        generatedAt: new Date().toISOString(),
        signals
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 }))
      })
    }
  );
