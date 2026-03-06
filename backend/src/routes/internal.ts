import { Elysia, t } from "elysia";
import { logger } from "../lib/pino";
import { getAnalysisRuntimeHealth } from "../queue/analysis-runtime";
import { createRpcAttribution } from "../services/wallet/rpc-attribution";
import { fetchTransactionForReplay } from "../services/wallet/rpc-replay";

export const internalRoutes = new Elysia({ prefix: "/internal" })
  .post(
    "/rpc-attribution",
    async ({ body }) => {

      const attribution = await createRpcAttribution({
        signature: body.signature,
        marketTicker: body.marketTicker,
        side: body.side,
        walletAddress: body.walletAddress,
        sizeUsdEst: body.sizeUsdEst
      });

      logger.info(
        {
          attributionId: attribution.attributionId,
          marketTicker: body.marketTicker,
          signature: body.signature,
          source: "rpc_replay"
        },
        "rpc attribution created"
      );

      return {
        source: "rpc_replay",
        attribution
      };
    },
    {
      body: t.Object({
        signature: t.String(),
        marketTicker: t.String(),
        side: t.Optional(t.Union([t.Literal("YES"), t.Literal("NO")])),
        walletAddress: t.Optional(t.String()),
        sizeUsdEst: t.Optional(t.Numeric({ minimum: 0 }))
      })
    }
  )
  .get(
    "/rpc-replay/:signature",
    async ({ params, set }) => {

      const tx = await fetchTransactionForReplay(params.signature);
      if (!tx) {
        logger.warn({ signature: params.signature }, "rpc replay transaction not found");
        set.status = 404;
        return {
          error: "NotFound",
          message: "Transaction not found via RPC replay"
        };
      }

      return {
        signature: params.signature,
        transaction: tx
      };
    },
    {
      params: t.Object({
        signature: t.String()
      })
    }
  )
  .get("/diagnostics", async () => {
    return {
      generatedAt: new Date().toISOString(),
      runtime: await getAnalysisRuntimeHealth()
    };
  });
