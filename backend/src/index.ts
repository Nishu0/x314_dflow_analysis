import { Elysia } from "elysia";
import { env } from "./config";
import { healthRoutes } from "./routes/health";
import { marketRoutes } from "./routes/markets";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

const app = new Elysia()
  .use(healthRoutes)
  .use(marketRoutes)
  .get("/", () => ({
    name: "x314 dFlow Analysis Backend",
    docs: {
      health: "/health",
      rawMarkets: "/markets/raw",
      convictions: "/markets/convictions"
    }
  }))
  .onError(({ code, error }) => {
    const message = getErrorMessage(error);

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
  })
  .listen(env.PORT);

console.log(`x314 backend listening on http://localhost:${app.server?.port}`);
