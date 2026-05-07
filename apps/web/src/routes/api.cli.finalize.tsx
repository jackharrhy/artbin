import type { Route } from "./+types/api.cli.finalize";
import { useLogger } from "evlog/react-router";
import { requireCliAuth } from "~/lib/cli-auth.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq, like } from "drizzle-orm";
import { cleanFolderPath } from "@artbin/core/detection/filenames";
import { finalizeFolders } from "~/lib/files.server";

/**
 * POST /api/cli/finalize
 *
 * Called by the CLI after all upload batches are complete.
 * Recalculates folder counts and generates preview images for the
 * root folder and all its descendants.
 */
export async function action({ request }: Route.ActionArgs) {
  const log = useLogger();
  const user = await requireCliAuth(request);
  log.set({ userId: user.id });

  const body = (await request.json()) as { parentFolder: string };
  const slug = cleanFolderPath(body.parentFolder);

  // Find the root folder and all descendants
  const rootFolder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!rootFolder) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  // Get all folders under this slug (including the root itself)
  const allFolders = await db.query.folders.findMany({
    where: like(folders.slug, `${slug}%`),
  });

  const folderIds = allFolders.map((f) => f.id);

  log.set({ finalize: { rootSlug: slug, folderCount: folderIds.length } });

  await finalizeFolders(folderIds, (err, fId) =>
    log.error(err, { step: "folder-preview", folderId: fId }),
  );

  return Response.json({ finalized: folderIds.length });
}
