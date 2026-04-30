import { existsSync } from "fs";
import { basename, extname } from "path";
import { db } from "~/db/connection.server";
import { folders, files, users } from "~/db";
import { eq, and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ensureDir,
  slugToPath,
  moveFile,
  deleteFolder,
  recalculateFolderCounts,
  getFilePath,
} from "./files.server";
import { generateFolderPreview } from "./folder-preview.server";
import { useLogger } from "evlog/react-router";

export const INBOX_SLUG = "_inbox";
export const INBOX_NAME = "Inbox";

export async function ensureInboxFolder(): Promise<string> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, INBOX_SLUG),
  });

  if (existing) {
    return existing.id;
  }

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name: INBOX_NAME,
    slug: INBOX_SLUG,
    parentId: null,
  });

  await ensureDir(slugToPath(INBOX_SLUG));

  return id;
}

export async function createUploadSession(
  uploaderId: string,
): Promise<{ id: string; slug: string }> {
  const inboxId = await ensureInboxFolder();
  const sessionId = nanoid();
  const sessionName = nanoid();
  const sessionSlug = `${INBOX_SLUG}/${sessionName}`;

  await db.insert(folders).values({
    id: sessionId,
    name: sessionName,
    slug: sessionSlug,
    parentId: inboxId,
    ownerId: uploaderId,
  });

  await ensureDir(slugToPath(sessionSlug));

  return { id: sessionId, slug: sessionSlug };
}

/**
 * Collect all folder IDs in a session's tree (the session folder itself
 * plus any subfolders created from relativePath structure).
 */
async function getSessionFolderIds(sessionFolderId: string): Promise<string[]> {
  const ids: string[] = [sessionFolderId];
  const queue = [sessionFolderId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await db.query.folders.findMany({
      where: eq(folders.parentId, parentId),
      columns: { id: true },
    });
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }

  return ids;
}

/**
 * Find a unique destination path by appending -2, -3, etc. if a file
 * already exists at the target path (in the DB or on disk).
 */
async function findUniquePath(destSlug: string, fileName: string): Promise<string> {
  const ext = extname(fileName);
  const base = basename(fileName, ext);
  let candidate = `${destSlug}/${fileName}`;

  // Check DB (unique constraint on files.path) and disk
  let suffix = 1;
  while (true) {
    const existing = await db.query.files.findFirst({
      where: eq(files.path, candidate),
      columns: { id: true },
    });
    if (!existing && !existsSync(getFilePath(candidate))) {
      return candidate;
    }
    suffix++;
    candidate = `${destSlug}/${base}-${suffix}${ext}`;
  }
}

export async function approveSession(
  sessionFolderId: string,
  destinationFolderId: string,
  destinationSlug: string,
): Promise<{ approvedCount: number; skippedCount: number }> {
  // Find all pending files across the session tree (including subfolders)
  const sessionFolderIds = await getSessionFolderIds(sessionFolderId);

  // Build a map of folder ID -> slug for computing relative paths
  const folderSlugMap = new Map<string, string>();
  for (const fid of sessionFolderIds) {
    const f = await db.query.folders.findFirst({
      where: eq(folders.id, fid),
      columns: { id: true, slug: true },
    });
    if (f) folderSlugMap.set(f.id, f.slug);
  }

  const sessionSlug = folderSlugMap.get(sessionFolderId) ?? "";

  const pendingFiles = await db.query.files.findMany({
    where: and(inArray(files.folderId, sessionFolderIds), eq(files.status, "pending")),
  });

  let skippedCount = 0;

  // Cache for destination subfolder resolution: relative path -> { id, slug }
  const destFolderCache = new Map<string, { id: string; slug: string }>();
  destFolderCache.set("", { id: destinationFolderId, slug: destinationSlug });

  // Resolve (or create) a destination folder for a given relative path
  // e.g. relative = "metals/rusty" -> creates textures/metals, then textures/metals/rusty
  async function resolveDestFolder(relative: string): Promise<{ id: string; slug: string }> {
    if (destFolderCache.has(relative)) return destFolderCache.get(relative)!;

    const parts = relative.split("/");
    let currentId = destinationFolderId;
    let currentSlug = destinationSlug;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partialRelative = parts.slice(0, i + 1).join("/");

      if (destFolderCache.has(partialRelative)) {
        const cached = destFolderCache.get(partialRelative)!;
        currentId = cached.id;
        currentSlug = cached.slug;
        continue;
      }

      const nestedSlug = `${currentSlug}/${part}`;
      let existing = await db.query.folders.findFirst({
        where: eq(folders.slug, nestedSlug),
      });

      if (!existing) {
        const newId = nanoid();
        await db.insert(folders).values({
          id: newId,
          name: part,
          slug: nestedSlug,
          parentId: currentId,
        });
        currentId = newId;
        currentSlug = nestedSlug;
      } else {
        currentId = existing.id;
        currentSlug = existing.slug;
      }
      destFolderCache.set(partialRelative, { id: currentId, slug: currentSlug });
    }

    return { id: currentId, slug: currentSlug };
  }

  const touchedFolderIds = new Set<string>([destinationFolderId]);

  for (const file of pendingFiles) {
    // Compute relative subfolder path from session structure
    // e.g. session slug = "_inbox/abc123", file's folder slug = "_inbox/abc123/metals/rusty"
    //   -> relative = "metals/rusty"
    const fileFolderSlug = folderSlugMap.get(file.folderId) ?? sessionSlug;
    const relative = fileFolderSlug.startsWith(sessionSlug + "/")
      ? fileFolderSlug.slice(sessionSlug.length + 1)
      : "";

    // Resolve the destination folder (creating subfolder records as needed)
    const destFolder = await resolveDestFolder(relative);
    touchedFolderIds.add(destFolder.id);

    const newPath = await findUniquePath(destFolder.slug, file.name);

    // Move file on disk, skip gracefully if source is missing
    const sourcePath = getFilePath(file.path);
    if (existsSync(sourcePath)) {
      await moveFile(file.path, newPath);
    } else {
      skippedCount++;
    }

    await db
      .update(files)
      .set({
        status: "approved",
        folderId: destFolder.id,
        path: newPath,
      })
      .where(eq(files.id, file.id));
  }

  await recalculateFolderCounts([...touchedFolderIds]);

  // Generate folder preview images for all touched destination folders
  for (const folderId of touchedFolderIds) {
    try {
      await generateFolderPreview(folderId);
    } catch (err) {
      const log = useLogger();
      log.error(err instanceof Error ? err : new Error(String(err)), {
        step: "folder-preview",
        folderId,
      });
    }
  }

  // Delete session folder tree (disk + DB)
  const sessionFolder = await db.query.folders.findFirst({
    where: eq(folders.id, sessionFolderId),
  });

  if (sessionFolder) {
    await deleteFolder(sessionFolder.slug);
  }

  // Delete subfolders first (children before parent)
  const subfolderIds = sessionFolderIds.filter((id) => id !== sessionFolderId);
  if (subfolderIds.length > 0) {
    await db.delete(folders).where(inArray(folders.id, subfolderIds));
  }
  await db.delete(folders).where(eq(folders.id, sessionFolderId));

  return { approvedCount: pendingFiles.length, skippedCount };
}

export async function rejectSession(sessionFolderId: string): Promise<{ rejectedCount: number }> {
  const sessionFolderIds = await getSessionFolderIds(sessionFolderId);

  const pendingFiles = await db.query.files.findMany({
    where: and(inArray(files.folderId, sessionFolderIds), eq(files.status, "pending")),
  });

  // Move rejected files to the inbox folder so they survive the cascade
  // delete of the session folder. Disk files stay for later cleanup.
  const inboxId = await ensureInboxFolder();

  for (const file of pendingFiles) {
    await db
      .update(files)
      .set({ status: "rejected", folderId: inboxId })
      .where(eq(files.id, file.id));
  }

  // Delete subfolders first, then session folder
  const subfolderIds = sessionFolderIds.filter((id) => id !== sessionFolderId);
  if (subfolderIds.length > 0) {
    await db.delete(folders).where(inArray(folders.id, subfolderIds));
  }
  await db.delete(folders).where(eq(folders.id, sessionFolderId));

  return { rejectedCount: pendingFiles.length };
}

export async function getPendingSessionsWithFiles(): Promise<
  Array<{
    folder: typeof folders.$inferSelect;
    files: (typeof files.$inferSelect)[];
    uploader: typeof users.$inferSelect | null;
    suggestedFolder: typeof folders.$inferSelect | null;
  }>
> {
  const inbox = await db.query.folders.findFirst({
    where: eq(folders.slug, INBOX_SLUG),
  });

  if (!inbox) {
    return [];
  }

  const sessionFolders = await db.query.folders.findMany({
    where: eq(folders.parentId, inbox.id),
  });

  const results: Array<{
    folder: typeof folders.$inferSelect;
    files: (typeof files.$inferSelect)[];
    uploader: typeof users.$inferSelect | null;
    suggestedFolder: typeof folders.$inferSelect | null;
  }> = [];

  for (const sessionFolder of sessionFolders) {
    // Find files across the whole session tree (including subfolders)
    const sessionFolderIds = await getSessionFolderIds(sessionFolder.id);
    const pendingFiles = await db.query.files.findMany({
      where: and(inArray(files.folderId, sessionFolderIds), eq(files.status, "pending")),
    });

    if (pendingFiles.length === 0) {
      continue;
    }

    let uploader: typeof users.$inferSelect | null = null;
    if (sessionFolder.ownerId) {
      uploader =
        (await db.query.users.findFirst({
          where: eq(users.id, sessionFolder.ownerId),
        })) ?? null;
    }

    let suggestedFolder: typeof folders.$inferSelect | null = null;
    const fileWithSuggestion = pendingFiles.find((f) => f.suggestedFolderId);
    if (fileWithSuggestion?.suggestedFolderId) {
      suggestedFolder =
        (await db.query.folders.findFirst({
          where: eq(folders.id, fileWithSuggestion.suggestedFolderId),
        })) ?? null;
    }

    results.push({
      folder: sessionFolder,
      files: pendingFiles,
      uploader,
      suggestedFolder,
    });
  }

  return results;
}
