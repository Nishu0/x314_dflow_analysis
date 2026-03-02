import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ prefix: "/health" }).get("/", () => ({
  status: "ok",
  service: "x314-dflow-backend",
  timestamp: new Date().toISOString()
}));
