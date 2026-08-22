import type { Route } from "./+types/api.folder.download";
import { ZipArchive } from "archiver";
import { PassThrough } from "stream";
import { existsSync } from "fs";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq } from "drizzle-orm";
import { slugToPath } from "~/lib/files.server";

/**
 * GET /api/folder/download/:slug/*
 *
 * Streams a folder's contents as a ZIP file. Reads files from disk
 * and pipes through archiver directly to the response -- no buffering
 * the entire archive in memory.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const slug = params["*"]!;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!folder) {
    return new Response("Folder not found", { status: 404 });
  }

  const dirPath = slugToPath(folder.slug);
  if (!existsSync(dirPath)) {
    return new Response("Folder directory not found", { status: 404 });
  }

  // Create a zip archive that streams from disk
  const archive = new ZipArchive({ store: true }); // store = no compression (faster, files are already compressed images)
  const passthrough = new PassThrough();

  archive.pipe(passthrough);
  archive.directory(dirPath, folder.name);
  archive.finalize();

  const zipName = `${folder.name}.zip`;

  return new Response(passthrough as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(zipName)}"`,
      "Transfer-Encoding": "chunked",
    },
  });
}
