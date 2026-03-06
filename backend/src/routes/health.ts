import { Elysia } from "elysia";
import { getAnalysisRuntimeHealth } from "../queue/analysis-runtime";

export const healthRoutes = new Elysia({ prefix: "/health" }).get("/", async () => {
  const queue = await getAnalysisRuntimeHealth();

  return {
    status: "ok",
    service: "x314-dflow-backend",
    timestamp: new Date().toISOString(),
    queue
  };
});
