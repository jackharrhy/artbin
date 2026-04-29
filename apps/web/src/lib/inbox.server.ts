import { db } from "~/db/connection.server";
import { folders, files, users } from "~/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ensureDir,
  slugToPath,
  moveFile,
  deleteFolder,
  recalculateFolderCounts,
} from "./files.server";

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

export async function approveSession(
  sessionFolderId: string,
  destinationFolderId: string,
  destinationSlug: string,
): Promise<{ approvedCount: number }> {
  const pendingFiles = await db.query.files.findMany({
    where: and(eq(files.folderId, sessionFolderId), eq(files.status, "pending")),
  });

  for (const file of pendingFiles) {
    const newPath = `${destinationSlug}/${file.name}`;
    await moveFile(file.path, newPath);
    await db
      .update(files)
      .set({
        status: "approved",
        folderId: destinationFolderId,
        path: newPath,
      })
      .where(eq(files.id, file.id));
  }

  await recalculateFolderCounts([destinationFolderId]);

  // Delete the empty session folder record and its disk directory
  const sessionFolder = await db.query.folders.findFirst({
    where: eq(folders.id, sessionFolderId),
  });

  if (sessionFolder) {
    await deleteFolder(sessionFolder.slug);
  }

  await db.delete(folders).where(eq(folders.id, sessionFolderId));

  return { approvedCount: pendingFiles.length };
}

export async function rejectSession(sessionFolderId: string): Promise<{ rejectedCount: number }> {
  const pendingFiles = await db.query.files.findMany({
    where: and(eq(files.folderId, sessionFolderId), eq(files.status, "pending")),
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
    const pendingFiles = await db.query.files.findMany({
      where: and(eq(files.folderId, sessionFolder.id), eq(files.status, "pending")),
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
