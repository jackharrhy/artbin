import type * as Route from "./types.ts";
import { createRequestLogger } from "evlog";
import { requireCliAuth } from "#lib/cli-auth.server";
import { db } from "#db/connection.server";
import { files } from "#db";
import { inArray } from "drizzle-orm";

interface ManifestInput {
  parentFolder: string;
  files: { path: string; sha256: string; size: number }[];
}

export async function action({ request }: Route.ActionArgs) {
  const log = createRequestLogger();
  await requireCliAuth(request);

  const body = (await request.json()) as ManifestInput;
  log.set({ manifest: { parentFolder: body.parentFolder, fileCount: body.files.length } });

  const parentFolder = body.parentFolder;

  // Build all full paths
  const allPaths = body.files.map((f) => `${parentFolder}/${f.path}`);

  // Single query to find all existing files
  const foundFiles =
    allPaths.length > 0
      ? await db.query.files.findMany({
          where: inArray(files.path, allPaths),
          columns: { path: true },
        })
      : [];
  const existingPathSet = new Set(foundFiles.map((f) => f.path));

  // Split into new vs existing
  const newFiles = body.files
    .filter((f) => !existingPathSet.has(`${parentFolder}/${f.path}`))
    .map((f) => f.path);
  const existingFiles = body.files
    .filter((f) => existingPathSet.has(`${parentFolder}/${f.path}`))
    .map((f) => f.path);

  log.set({ manifest: { newCount: newFiles.length, existingCount: existingFiles.length } });
  return Response.json({ newFiles, existingFiles });
}
