/**
 * Background job system for artbin
 * 
 * Jobs are stored in the database and processed by a simple polling loop.
 * This is a simple implementation suitable for single-server deployments.
 */

import { db, jobs, type Job, type JobStatus } from "~/db";
import { eq, and, or, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Result } from "better-result";

// ============================================================================
// Job Creation & Management
// ============================================================================

export interface CreateJobInput {
  type: string;
  input: Record<string, unknown>;
  userId?: string;
}

/**
 * Create a new job
 */
export async function createJob(params: CreateJobInput): Promise<Job> {
  const id = nanoid();
  
  const [job] = await db
    .insert(jobs)
    .values({
      id,
      type: params.type,
      input: JSON.stringify(params.input),
      userId: params.userId ?? null,
      status: "pending",
    })
    .returning();
  
  return job;
}

/**
 * Get a job by ID
 */
export async function getJob(id: string): Promise<Job | undefined> {
  return db.query.jobs.findFirst({
    where: eq(jobs.id, id),
  });
}

/**
 * Get all jobs for a user
 */
export async function getUserJobs(userId: string, limit = 50): Promise<Job[]> {
  return db.query.jobs.findMany({
    where: eq(jobs.userId, userId),
    orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    limit,
  });
}

/**
 * Get all recent jobs (for admin)
 */
export async function getAllJobs(limit = 100): Promise<Job[]> {
  return db.query.jobs.findMany({
    orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    limit,
  });
}

/**
 * Update job progress
 */
export async function updateJobProgress(
  id: string,
  progress: number,
  message?: string
): Promise<void> {
  await db
    .update(jobs)
    .set({
      progress,
      progressMessage: message ?? null,
    })
    .where(eq(jobs.id, id));
}

/**
 * Mark job as started
 */
export async function startJob(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

/**
 * Mark job as completed
 */
export async function completeJob(
  id: string,
  output: Record<string, unknown>
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "completed",
      progress: 100,
      output: JSON.stringify(output),
      completedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

/**
 * Mark job as failed
 */
export async function failJob(id: string, error: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "failed",
      error,
      completedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

/**
 * Cancel a pending job
 */
export async function cancelJob(id: string) {
  const job = await getJob(id);
  if (!job) {
    return Result.err(new Error("Job not found"));
  }
  if (job.status !== "pending") {
    return Result.err(new Error("Only pending jobs can be cancelled"));
  }

  const result = await db
    .update(jobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, "pending")));
  
  if (result.changes === 0) {
    return Result.err(new Error("Job could not be cancelled"));
  }

  const updatedJob = await getJob(id);
  return Result.ok(updatedJob!);
}

/**
 * Delete a job and clean up any associated temp files
 */
export async function deleteJob(id: string): Promise<boolean> {
  const job = await getJob(id);
  if (!job) return false;

  // Try to clean up temp files if the job input contains a tempFile path
  try {
    const input = JSON.parse(job.input) as Record<string, unknown>;
    if (typeof input.tempFile === "string" && input.tempFile.includes("/tmp/")) {
      const { unlink } = await import("fs/promises");
      try {
        await unlink(input.tempFile);
      } catch {
        // File may already be deleted, ignore
      }
    }
  } catch {
    // Ignore JSON parse errors
  }

  const result = await db.delete(jobs).where(eq(jobs.id, id));
  return result.changes > 0;
}

/**
 * Reset a stuck running job back to pending
 * Only works for jobs that have been running for more than the threshold
 */
export async function resetStuckJob(id: string, stuckThresholdMinutes = 30) {
  const job = await getJob(id);
  if (!job) return Result.err(new Error("Job not found"));
  if (job.status !== "running") return Result.err(new Error("Job is not running"));

  // Check if the job has been running long enough to be considered stuck
  if (job.startedAt) {
    const runningTime = Date.now() - new Date(job.startedAt).getTime();
    const thresholdMs = stuckThresholdMinutes * 60 * 1000;
    if (runningTime < thresholdMs) {
      return Result.err(new Error("Job is not stuck"));
    }
  }

  const result = await db
    .update(jobs)
    .set({
      status: "pending",
      startedAt: null,
      progress: 0,
      progressMessage: "Reset after appearing stuck",
    })
    .where(eq(jobs.id, id));

  if (result.changes === 0) {
    return Result.err(new Error("Job could not be reset"));
  }

  const updatedJob = await getJob(id);
  return Result.ok(updatedJob!);
}

/**
 * Check if a job appears to be stuck (running for too long)
 */
export function isJobStuck(job: Job, thresholdMinutes = 30): boolean {
  if (job.status !== "running") return false;
  if (!job.startedAt) return false;

  const runningTime = Date.now() - new Date(job.startedAt).getTime();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  return runningTime > thresholdMs;
}

// ============================================================================
// Job Processing
// ============================================================================

type JobHandler = (job: Job, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

const jobHandlers = new Map<string, JobHandler>();

/**
 * Register a job handler
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
  jobHandlers.set(type, handler);
}

/**
 * Get the next pending job
 */
async function getNextJob(): Promise<Job | undefined> {
  return db.query.jobs.findFirst({
    where: eq(jobs.status, "pending"),
    orderBy: (jobs, { asc }) => [asc(jobs.createdAt)],
  });
}

/**
 * Process a single job
 */
export async function processJob(job: Job) {
  const handler = jobHandlers.get(job.type);
  
  if (!handler) {
    await failJob(job.id, `Unknown job type: ${job.type}`);
    return Result.err(new Error(`Unknown job type: ${job.type}`));
  }
  
  try {
    await startJob(job.id);
    const input = JSON.parse(job.input) as Record<string, unknown>;
    const output = await handler(job, input);
    await completeJob(job.id, output);
    const completedJob = await getJob(job.id);
    return Result.ok(completedJob!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(job.id, message);
    console.error(`Job ${job.id} failed:`, error);
    return Result.err(new Error(message));
  }
}

// ============================================================================
// Job Runner
// ============================================================================

let isRunning = false;
let pollInterval: NodeJS.Timeout | null = null;

/**
 * Start the job runner (polls for jobs every N seconds)
 */
export function startJobRunner(intervalMs = 2000): void {
  if (isRunning) return;
  
  isRunning = true;
  console.log("[JobRunner] Started");
  
  const poll = async () => {
    if (!isRunning) return;
    
    try {
      const job = await getNextJob();
      if (job) {
        console.log(`[JobRunner] Processing job ${job.id} (${job.type})`);
        await processJob(job);
      }
    } catch (error) {
      console.error("[JobRunner] Error:", error);
    }
    
    if (isRunning) {
      pollInterval = setTimeout(poll, intervalMs);
    }
  };
  
  // Start polling
  poll();
}

/**
 * Stop the job runner
 */
export function stopJobRunner(): void {
  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  console.log("[JobRunner] Stopped");
}

/**
 * Check if the job runner is running
 */
export function isJobRunnerActive(): boolean {
  return isRunning;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up old completed/failed jobs (older than N days)
 */
export async function cleanupOldJobs(daysOld = 7): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  const result = await db
    .delete(jobs)
    .where(
      and(
        or(eq(jobs.status, "completed"), eq(jobs.status, "failed"), eq(jobs.status, "cancelled")),
        lt(jobs.completedAt, cutoff)
      )
    );
  
  return result.changes;
}

/**
 * Reset stuck jobs (running for more than N minutes)
 */
export async function resetStuckJobs(minutesOld = 30): Promise<number> {
  const cutoff = new Date(Date.now() - minutesOld * 60 * 1000);
  
  const result = await db
    .update(jobs)
    .set({ status: "pending", startedAt: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.startedAt, cutoff)));
  
  return result.changes;
}
