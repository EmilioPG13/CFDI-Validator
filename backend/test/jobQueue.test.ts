// Requires a REAL Postgres -- an in-memory fake can't reproduce FOR UPDATE SKIP LOCKED's
// actual row-locking semantics, which is the entire thing this test exists to prove.
// Gated on DATABASE_URL_TEST rather than the app's own DATABASE_URL, so running the full
// suite against a placeholder/production connection string doesn't accidentally create
// and race real rows against it. Skips gracefully (not a failure) when unset, matching
// the plan's own "honest carve-out" framing.
//
// `node --test` runs each test file as its own isolated process, so unlike every other
// test file here (which gets dotenv for free by importing something that imports
// env.ts), this file can't rely on another import having loaded .env first -- it
// deliberately avoids importing env.ts/prismaClient.ts at top level (see the comment
// below on why). Must load dotenv explicitly, or DATABASE_URL_TEST reads as undefined
// even when it's set in .env, and the test silently skips instead of running. Confirmed
// this was happening for real, not just a theoretical race.
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;

test("claimPendingJobs: two concurrent claims never take the same row", { skip: !DATABASE_URL_TEST }, async () => {
  if (!DATABASE_URL_TEST) return;

  // Point THIS process's prisma singleton at the test database for the duration of this
  // test file only -- must be set before prismaClient.ts/env.ts are first imported, so
  // this test file imports them dynamically after setting the env var, rather than via
  // static top-level imports like every other test file.
  process.env.DATABASE_URL = DATABASE_URL_TEST;
  const { prisma } = await import("../src/prismaClient.ts");
  const { claimPendingJobs, createJobsForBatch } = await import("../src/jobs/queue.ts");

  const batchId = `test-batch-${Date.now()}`;
  await createJobsForBatch(batchId, [
    { ruleId: "cfdi-cancelado-sat", fieldPath: "x", severity: "error", satReference: "s", evidence: {} },
    { ruleId: "cfdi-cancelado-sat", fieldPath: "y", severity: "error", satReference: "s", evidence: {} },
    { ruleId: "cfdi-cancelado-sat", fieldPath: "z", severity: "error", satReference: "s", evidence: {} },
    { ruleId: "cfdi-cancelado-sat", fieldPath: "w", severity: "error", satReference: "s", evidence: {} },
  ]);

  try {
    // Fire two concurrent claims for 2 rows each against the same 4-row pool -- if the
    // atomic claim works, the two result sets must be completely disjoint (4 total, no
    // overlap). If it doesn't, at least one row id appears in both.
    const [batchA, batchB] = await Promise.all([claimPendingJobs(2), claimPendingJobs(2)]);

    const idsA = new Set(batchA.map((j) => j.id));
    const idsB = new Set(batchB.map((j) => j.id));
    const overlap = [...idsA].filter((id) => idsB.has(id));

    assert.deepEqual(overlap, [], "concurrent claims must never return the same job id");
    assert.equal(idsA.size + idsB.size, 4, "all 4 seeded jobs must have been claimed exactly once, across both calls");

    for (const job of [...batchA, ...batchB]) {
      const row = await prisma.job.findUnique({ where: { id: job.id } });
      assert.equal(row?.status, "processing");
    }
  } finally {
    await prisma.job.deleteMany({ where: { batchId } });
  }
});

test("(informational) DATABASE_URL_TEST not set -- jobQueue.test.ts's real assertion above was skipped, not failed", { skip: !!DATABASE_URL_TEST }, () => {
  // Intentionally empty. Exists so a `node --test` summary shows a visible, named
  // reason for the skip rather than the suite silently having one fewer test than
  // expected -- the same "don't let a skip look identical to nothing having run"
  // discipline this project already applies elsewhere (satUnverified, rejected jobs).
});
