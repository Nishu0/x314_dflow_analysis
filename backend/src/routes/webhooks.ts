import { Elysia } from "elysia";
import { logger } from "../lib/pino";
import { persistHeliusWebhookPayload, processHeliusWebhookEvent } from "../services/wallet/helius-attribution";
import type { JsonValue } from "../types/json";

function toPayloadList(body: unknown): JsonValue[] {
  if (Array.isArray(body)) {
    return body as JsonValue[];
  }

  if (body && typeof body === "object") {
    return [body as JsonValue];
  }

  return [];
}

export const webhookRoutes = new Elysia({ prefix: "/webhooks" }).post("/helius", async ({ body, set }) => {
  const payloads = toPayloadList(body);
  if (payloads.length === 0) {
    set.status = 400;
    return {
      error: "BadRequest",
      message: "Expected JSON object or JSON array body"
    };
  }

  const results = await Promise.allSettled(
    payloads.map(async (payload) => {
      const eventId = await persistHeliusWebhookPayload(payload);
      const processed = await processHeliusWebhookEvent(eventId);
      return {
        eventId,
        attributionCount: processed.attributionCount
      };
    })
  );

  const success = results.filter((row) => row.status === "fulfilled");
  const failed = results
    .filter((row): row is PromiseRejectedResult => row.status === "rejected")
    .map((row) => (row.reason instanceof Error ? row.reason.message : String(row.reason)));
  const attributionCount = success.reduce((acc, row) => acc + row.value.attributionCount, 0);

  logger.info(
    {
      eventsReceived: payloads.length,
      eventsProcessed: success.length,
      eventsFailed: failed.length,
      attributionsCreated: attributionCount,
      failureSamples: failed.slice(0, 10)
    },
    "helius webhook ingested"
  );

  return {
    received: payloads.length,
    processed: success.length,
    failed: failed.length,
    attributionsCreated: attributionCount,
    failures: failed.slice(0, 10)
  };
});
