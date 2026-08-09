// Reactive, not poll-based -- Render's free tier sleeps after 15 min idle, so a
// setInterval background poller inside the process would buy nothing and die with the
// dyno. Called from POST /internal/drain-queue, itself triggered by a fire-and-forget
// browser call right after POST /api/explain responds, plus optionally an external
// keep-warm cron ping. Default max=1 is deliberately conservative: a single Explainer
// call can take 100+ seconds on NIM's free tier (167s measured for a trivial call in
// job-search-agents), so draining many jobs in one HTTP request risks whatever timeout
// the host imposes -- results simply arrive across more drain invocations instead.
//
// No wall-clock early-abort here, deliberately: claimPendingJobs() marks every job it
// returns as "processing" atomically, upfront, in one statement. Bailing out of the loop
// partway through would leave already-claimed jobs stuck in "processing" forever (only
// "pending" rows are eligible to be claimed again) -- an orphaned-job bug, not a safety
// feature. Keeping `max` small (the default) is what actually bounds one invocation's
// wall-clock time; nimProvider.ts's own 300s per-call timeout is the real backstop.
import { claimPendingJobs } from "./queue.ts";
import { processJob } from "./processor.ts";

export interface DrainResult {
  claimed: number;
  processed: number;
}

export async function drainQueue(max = 1): Promise<DrainResult> {
  const jobs = await claimPendingJobs(max);
  for (const job of jobs) {
    await processJob(job);
  }
  return { claimed: jobs.length, processed: jobs.length };
}
