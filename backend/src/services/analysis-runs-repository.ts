import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { analysisRuns } from "../db/schema";

export type AnalysisRunRecord = typeof analysisRuns.$inferSelect;

export async function createOrGetAnalysisRun(params: {
  runId: string;
  idempotencyKey: string;
  scheduledFor: Date;
  attempt: number;
}): Promise<AnalysisRunRecord> {
  const inserted = await db
    .insert(analysisRuns)
    .values({
      runId: params.runId,
      pipelineName: "analysis_tick",
      scheduledFor: params.scheduledFor,
      status: "QUEUED",
      attempt: params.attempt,
      idempotencyKey: params.idempotencyKey
    })
    .onConflictDoNothing({ target: analysisRuns.idempotencyKey })
    .returning();

  if (inserted.length > 0) {
    return inserted[0];
  }

  const existing = await db
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existing.length === 0) {
    throw new Error("Failed to create or load analysis run");
  }

  return existing[0];
}

export async function markAnalysisRunRunning(runId: string, workerId: string): Promise<void> {
  await db
    .update(analysisRuns)
    .set({
      status: "RUNNING",
      workerId,
      startedAt: new Date()
    })
    .where(and(eq(analysisRuns.runId, runId), eq(analysisRuns.status, "QUEUED")));
}

export async function markAnalysisRunFailed(runId: string, errorMessage: string): Promise<void> {
  await db
    .update(analysisRuns)
    .set({
      status: "FAILED",
      error: errorMessage,
      finishedAt: new Date()
    })
    .where(eq(analysisRuns.runId, runId));
}

export async function markAnalysisRunSucceeded(params: {
  runId: string;
  marketsScanned: number;
  marketsScored: number;
  inputWindowStart: Date;
  inputWindowEnd: Date;
}): Promise<void> {
  await db
    .update(analysisRuns)
    .set({
      status: "SUCCEEDED",
      marketsScanned: params.marketsScanned,
      marketsScored: params.marketsScored,
      inputWindowStart: params.inputWindowStart,
      inputWindowEnd: params.inputWindowEnd,
      finishedAt: new Date(),
      error: null
    })
    .where(eq(analysisRuns.runId, params.runId));
}

export async function getLatestSuccessfulRun(): Promise<AnalysisRunRecord | null> {
  const rows = await db
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.status, "SUCCEEDED"))
    .orderBy(desc(analysisRuns.finishedAt))
    .limit(1);

  return rows[0] ?? null;
}
