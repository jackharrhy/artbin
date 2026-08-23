import { isJobRunnerActive, startJobRunner, stopJobRunner } from "#lib/jobs.server";

import "#lib/jobs/backfill-hashes-job.server";
import "#lib/jobs/extract-job.server";
import "#lib/jobs/folder-import-job.server";
import "#lib/jobs/regenerate-previews-job.server";
import "#lib/jobs/remote-import-job.server";
import "#lib/jobs/sadgrl-job.server";
import "#lib/jobs/scan-archives-job.server";
import "#lib/jobs/texturetown-job.server";
import "#lib/jobs/thejang-job.server";

export async function startBackgroundJobs(): Promise<void> {
  if (!isJobRunnerActive()) startJobRunner(2_000);
}

export function stopBackgroundJobs(): void {
  if (isJobRunnerActive()) stopJobRunner();
}
