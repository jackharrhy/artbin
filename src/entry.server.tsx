import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToString } from "react-dom/server";

// Import and start the job runner
import { startJobRunner, isJobRunnerActive } from "~/lib/jobs.server";

// Register job handlers
import "~/lib/extract-job.server";
import "~/lib/texturetown-job.server";
import "~/lib/thejang-job.server";
import "~/lib/sadgrl-job.server";
import "~/lib/scan-archives-job.server";

// Start the job runner (only once)
if (!isJobRunnerActive()) {
  startJobRunner(2000); // Poll every 2 seconds
  console.log("[Server] Job runner started");
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  const html = renderToString(
    <ServerRouter context={routerContext} url={request.url} />
  );

  responseHeaders.set("Content-Type", "text/html");

  return new Response(`<!DOCTYPE html>${html}`, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}
