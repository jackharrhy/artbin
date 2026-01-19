import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";

// Import and start the job runner
import { startJobRunner, isJobRunnerActive } from "~/lib/jobs.server";

// Register job handlers
import "~/lib/extract-job.server";
import "~/lib/texturetown-job.server";
import "~/lib/thejang-job.server";
import "~/lib/sadgrl-job.server";
import "~/lib/scan-archives-job.server";
import "~/lib/folder-import-job.server";

// Start the job runner (only once)
if (!isJobRunnerActive()) {
  startJobRunner(2000); // Poll every 2 seconds
  console.log("[Server] Job runner started");
}

const ABORT_DELAY = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(body as unknown as BodyInit, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
