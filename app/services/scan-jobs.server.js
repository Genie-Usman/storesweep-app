import { runScan } from "./scan-run.server.js";
import { logger } from "../utils/logger.server.js";

/**
 * In-process registry of running/completed scans so the dashboard can
 * start a scan and poll progress without holding a request open.
 *
 * Single-instance by design: jobs live in this process's memory, and the
 * Scan/CleanOperation tables remain the durable record (see
 * docs/ARCHITECTURE.md). Swap for a Redis/BullMQ queue when running
 * multiple instances.
 */

const JOB_TTL_MS = 30 * 60_000;
const MAX_FINISHED_JOBS = 100;

/** @type {Map<string, object>} key: `${shop}:${themeId || "main"}` */
const jobs = new Map();

const jobKey = (shop, themeId) => `${shop}:${themeId || "main"}`;

function snapshot(job) {
  return {
    jobKey: job.key,
    themeId: job.themeId,
    status: job.status,
    startedAt: job.startedAt,
    progress: { ...job.progress },
    result: job.status === "completed" ? job.result : null,
    error: job.status === "failed" ? job.error : null,
  };
}

function prune() {
  const now = Date.now();
  for (const [key, job] of jobs) {
    if (job.status !== "running" && now - job.startedAt > JOB_TTL_MS) {
      jobs.delete(key);
    }
  }

  const finished = [...jobs.values()]
    .filter((job) => job.status !== "running")
    .sort((left, right) => left.startedAt - right.startedAt);
  while (finished.length > MAX_FINISHED_JOBS) {
    const oldest = finished.shift();
    jobs.delete(oldest.key);
  }
}

/**
 * Start a background scan for a shop+theme. Returns the current job
 * snapshot; starting an already-running scan returns it instead of
 * launching a duplicate (`deduped: true`).
 */
export function startScanJob({
  admin,
  db,
  shop,
  themeId = null,
  runScanImpl = runScan,
}) {
  const key = jobKey(shop, themeId);
  const existing = jobs.get(key);

  if (existing && existing.status === "running") {
    return { job: snapshot(existing), deduped: true };
  }

  prune();

  const job = {
    key,
    shop,
    themeId,
    status: "running",
    startedAt: Date.now(),
    progress: { filesScanned: 0, totalFiles: 0, findingCount: 0, ignoredCount: 0 },
    result: null,
    error: null,
  };
  jobs.set(key, job);

  runScanImpl({
    admin,
    db,
    shop,
    themeId,
    onProgress: (progress) => {
      job.progress = { ...job.progress, ...progress };
    },
  })
    .then((result) => {
      job.status = "completed";
      job.result = result;
    })
    .catch((error) => {
      job.status = "failed";
      job.error =
        error instanceof Error ? error.message : "The theme scan failed.";
      logger.error("background scan failed", { shop, themeId, error });
    })
    .finally(() => {
      prune();
    });

  return { job: snapshot(job), deduped: false };
}

/** Current state of a shop's scan job, or null when none is tracked. */
export function getScanJob(shop, themeId = null) {
  const job = jobs.get(jobKey(shop, themeId));
  return job ? snapshot(job) : null;
}

/** Test/admin helper: forget all tracked jobs. */
export function resetScanJobs() {
  jobs.clear();
}

export default { startScanJob, getScanJob, resetScanJobs };
