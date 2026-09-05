import test from "node:test";
import assert from "node:assert/strict";

import {
  getScanJob,
  resetScanJobs,
  startScanJob,
} from "./scan-jobs.server.js";

const FILES = [
  {
    filename: "layout/theme.liquid",
    content: '<script src="https://code.tidio.co/key.js"></script>',
  },
];

function fakeAdmin() {
  return {
    graphql: async (query) => {
      if (/roles:\s*\[MAIN\]/.test(query)) {
        return {
          json: async () => ({
            data: {
              themes: { nodes: [{ id: "theme-1", name: "Dawn" }] },
            },
          }),
        };
      }
      return {
        json: async () => ({
          data: {
            theme: {
              files: {
                nodes: FILES.map(({ filename, content }) => ({
                  filename,
                  body: { content },
                })),
                pageInfo: { hasNextPage: false, endCursor: null },
                userErrors: [],
              },
            },
          },
        }),
      };
    },
  };
}

function fakeDb() {
  return {
    ignoredFinding: { findMany: async () => [] },
    ignoredApp: { findMany: async () => [] },
    scan: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "scan-1", data }),
    },
    scanFinding: { findMany: async () => [] },
    shop: { upsert: async () => ({}) },
    auditEvent: { create: async () => ({}) },
  };
}

function pollJob(shop, themeId, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const job = getScanJob(shop, themeId);
      if (job && job.status !== "running") return resolve(job);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("scan job did not finish in time"));
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

test.beforeEach(() => resetScanJobs());

test("runs a scan in the background and exposes its result", async () => {
  const { job, deduped } = startScanJob({
    admin: fakeAdmin(),
    db: fakeDb(),
    shop: "shop.example",
  });

  assert.equal(deduped, false);
  assert.equal(job.status, "running");

  const finished = await pollJob("shop.example", null);

  assert.equal(finished.status, "completed");
  assert.equal(finished.result.findingCount, 1);
  assert.equal(finished.result.themeName, "Dawn");
  assert.equal(getScanJob("shop.example", null).jobKey, finished.jobKey);
});

test("reports per-file progress while scanning", async () => {
  let progressSeen = null;
  const runScanImpl = async ({ onProgress }) => {
    onProgress({ filesScanned: 1, totalFiles: 2, findingCount: 0, ignoredCount: 0 });
    onProgress({ filesScanned: 2, totalFiles: 2, findingCount: 1, ignoredCount: 0 });
    return { scanId: "scan-1", findings: [{}] };
  };

  const { job } = startScanJob({
    admin: fakeAdmin(),
    db: fakeDb(),
    shop: "shop.example",
    runScanImpl,
  });

  assert.equal(job.progress.filesScanned, 2);
  assert.equal(job.progress.totalFiles, 2);

  const finished = await pollJob("shop.example", null);
  assert.equal(finished.status, "completed");
  progressSeen = finished.progress;
  assert.equal(progressSeen.findingCount, 1);
});

test("dedupes a start request while the job is still running", async () => {
  let releaseScan;
  const runScanImpl = () =>
    new Promise((resolve) => {
      releaseScan = () => resolve({ scanId: "scan-1", findings: [] });
    });

  const first = startScanJob({
    admin: fakeAdmin(),
    db: fakeDb(),
    shop: "shop.example",
    runScanImpl,
  });
  const second = startScanJob({
    admin: fakeAdmin(),
    db: fakeDb(),
    shop: "shop.example",
    runScanImpl,
  });

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.job.jobKey, second.job.jobKey);

  releaseScan();
  const finished = await pollJob("shop.example", null);
  assert.equal(finished.status, "completed");
});

test("tracks shops and themes independently", () => {
  let releaseScan;
  const runScanImpl = () =>
    new Promise((resolve) => {
      releaseScan = () => resolve({ scanId: "scan-1", findings: [] });
    });

  startScanJob({ admin: fakeAdmin(), db: fakeDb(), shop: "shop-a", runScanImpl });

  const other = startScanJob({
    admin: fakeAdmin(),
    db: fakeDb(),
    shop: "shop-b",
    runScanImpl,
  });
  assert.equal(other.deduped, false);

  releaseScan();
});

test("surfaces scan failures on the job", async () => {
  const runScanImpl = async () => {
    throw new Error("boom");
  };

  startScanJob({
    admin: fakeAdmin(),
    db: fakeDb(),
    shop: "shop.example",
    runScanImpl,
  });

  const finished = await pollJob("shop.example", null);
  assert.equal(finished.status, "failed");
  assert.equal(finished.error, "boom");
  assert.equal(finished.result, null);
});

test("returns null for shops with no tracked job", () => {
  assert.equal(getScanJob("nobody.example", null), null);
});
