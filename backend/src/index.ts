import { Elysia } from "elysia";
import { env } from "./config";
import { closeDbPool } from "./db/client";
import { logger } from "./lib/pino";
import { startAnalysisRuntime } from "./queue/analysis-runtime";
import { healthRoutes } from "./routes/health";
import { internalRoutes } from "./routes/internal";
import { marketRoutes } from "./routes/markets";
import { webhookRoutes } from "./routes/webhooks";
import { v1Routes } from "./routes/v1/index";

function getErrorMessage(
  error: Error | string | number | boolean | object | null | undefined
): string {
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

const app = new Elysia()
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    logger.info({ method: request.method, path: url.pathname }, "http request");
  })
  .onAfterHandle(({ request, set }) => {
    const url = new URL(request.url);
    logger.info({ method: request.method, path: url.pathname, status: set.status ?? 200 }, "http response");
  })
  .use(healthRoutes)
  .use(marketRoutes)
  .use(webhookRoutes)
  .use(internalRoutes)
  .use(v1Routes)
  .get("/", () => ({
    name: "x314 dFlow Analysis Backend",
    baseUrl: "http://localhost:3000",
    docs: {
      v1Api: "/api/v1",
      health: "/health",
      markets: "/markets",
      marketDetails: "/markets/:marketTicker/details",
      heliusWebhook: "/webhooks/helius",
      rpcAttribution: "/internal/rpc-attribution",
      diagnostics: "/internal/diagnostics"
    }
  }))
  .onError(({ code, error }) => {
    const message = getErrorMessage(error);
    logger.error({ code, message }, "http error");

    if (code === "VALIDATION") {
      return {
        error: "ValidationError",
        message
      };
    }

    return {
      error: "InternalError",
      message
    };
  });

const server = app.listen(env.PORT);
const stopAnalysisRuntime = await startAnalysisRuntime();

let shutdownPromise: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shutdownPromise) {
    logger.warn({ signal }, "shutdown already in progress");
    await shutdownPromise;
    return;
  }

  shutdownPromise = (async () => {
  logger.warn({ signal }, "shutdown signal received");
  await stopAnalysisRuntime();
  await closeDbPool();
  server.stop();
  logger.info({ signal }, "server stopped");
  })();

  await shutdownPromise;
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

logger.info({ port: server.server?.port }, "x314 backend listening");
