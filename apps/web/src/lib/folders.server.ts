import { join } from "path";
import { nanoid } from "nanoid";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { existsSync } from "fs";
import { rename } from "fs/promises";
import { cleanFolderSlug } from "@artbin/core/detection/filenames";
import { db as appDb, type AppDb } from "~/db/connection.server";
import { files, folders, type Folder } from "~/db";
import { ensureDir as ensureUploadsDir, UPLOADS_DIR } from "./files.server";
import { generateFolderPreview } from "./folder-preview.server";

export interface CreateFolderInput {
  name: string;
  slug: string;
  parentId: string | null;
  ownerId: string;
}

export interface CreateFolderDeps {
  db?: AppDb;
  uploadsDir?: string;
  createId?: () => string;
  ensureDir?: (path: string) => Promise<void>;
}

export interface CreatedFolder {
  id: string;
  name: string;
  slug: string;
}

export interface MoveFolderDeps {
  db?: AppDb;
  uploadsDir?: string;
  exists?: (path: string) => boolean;
  rename?: (from: string, to: string) => Promise<void>;
  ensureDir?: (path: string) => Promise<void>;
  generatePreview?: (folderId: string) => Promise<string | null>;
}

export interface MoveFolderOutput {
  folder?: Folder;
  movedFolders: number;
  movedFiles: number;
}

export interface CreateFolderAndMoveDeps extends MoveFolderDeps {
  createId?: () => string;
}

export { cleanFolderSlug };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function createFolder(input: CreateFolderInput, deps: CreateFolderDeps = {}) {
  const database = deps.db ?? appDb;
  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const createId = deps.createId ?? nanoid;
  const ensureDir = deps.ensureDir ?? ensureUploadsDir;

  const name = input.name.trim();
  const cleanSlug = cleanFolderSlug(input.slug);

  if (!name || !cleanSlug) {
    return Result.err(new Error("Name and slug are required"));
  }

  let fullSlug = cleanSlug;
  if (input.parentId) {
    const parentFolder = await database.query.folders.findFirst({
      where: eq(folders.id, input.parentId),
    });

    if (!parentFolder) {
      return Result.err(new Error("Parent folder not found"));
    }

    fullSlug = `${parentFolder.slug}/${cleanSlug}`;
  }

  const existing = await database.query.folders.findFirst({
    where: eq(folders.slug, fullSlug),
  });

  if (existing) {
    return Result.err(new Error(`Folder "${fullSlug}" already exists`));
  }

  try {
    const folderId = createId();
    await ensureDir(join(uploadsDir, fullSlug));

    await database.insert(folders).values({
      id: folderId,
      name,
      slug: fullSlug,
      parentId: input.parentId || null,
      ownerId: input.ownerId,
    });

    return Result.ok({
      id: folderId,
      name,
      slug: fullSlug,
    } satisfies CreatedFolder);
  } catch (error) {
    return Result.err(toError(error));
  }
}

async function getDescendantFolders(database: AppDb, folderId: string): Promise<Folder[]> {
  const descendants: Folder[] = [];
  const queue = [folderId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await database.query.folders.findMany({
      where: eq(folders.parentId, parentId),
    });

    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

async function wouldCreateCycle(
  database: AppDb,
  folderId: string,
  newParentId: string | null,
): Promise<boolean> {
  if (!newParentId) return false;
  if (newParentId === folderId) return true;

  const descendants = await getDescendantFolders(database, folderId);
  return descendants.some((descendant) => descendant.id === newParentId);
}

export async function moveFolder(
  folderId: string,
  newParentId: string | null,
  deps: MoveFolderDeps = {},
) {
  const database = deps.db ?? appDb;
  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const exists = deps.exists ?? existsSync;
  const moveDir = deps.rename ?? rename;
  const ensureDir = deps.ensureDir ?? ensureUploadsDir;
  const generatePreview = deps.generatePreview ?? generateFolderPreview;

  const folder = await database.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return Result.err(new Error("Folder not found"));
  }

  if (folder.parentId === newParentId) {
    return Result.ok({ folder, movedFolders: 0, movedFiles: 0 } satisfies MoveFolderOutput);
  }

  if (await wouldCreateCycle(database, folderId, newParentId)) {
    return Result.err(new Error("Cannot move folder into its own descendant"));
  }

  let newParentSlug = "";
  if (newParentId) {
    const newParent = await database.query.folders.findFirst({
      where: eq(folders.id, newParentId),
    });

    if (!newParent) {
      return Result.err(new Error("Parent folder not found"));
    }

    newParentSlug = newParent.slug;
  }

  const folderBaseName = folder.slug.includes("/") ? folder.slug.split("/").pop()! : folder.slug;
  const newSlug = newParentSlug ? `${newParentSlug}/${folderBaseName}` : folderBaseName;

  if (newSlug !== folder.slug) {
    const existingFolder = await database.query.folders.findFirst({
      where: eq(folders.slug, newSlug),
    });

    if (existingFolder) {
      return Result.err(new Error(`A folder already exists at "${newSlug}"`));
    }
  }

  const descendants = await getDescendantFolders(database, folderId);
  const oldSlug = folder.slug;
  const oldPath = join(uploadsDir, oldSlug);
  const newPath = join(uploadsDir, newSlug);

  if (newParentSlug) {
    await ensureDir(join(uploadsDir, newParentSlug));
  }

  if (exists(newPath)) {
    return Result.err(new Error(`Directory already exists at "${newSlug}"`));
  }

  try {
    let movedFolders = 0;
    let movedFiles = 0;

    await database
      .update(folders)
      .set({
        parentId: newParentId,
        slug: newSlug,
      })
      .where(eq(folders.id, folderId));
    movedFolders++;

    for (const descendant of descendants) {
      const descendantNewSlug = descendant.slug.replace(oldSlug, newSlug);
      await database
        .update(folders)
        .set({ slug: descendantNewSlug })
        .where(eq(folders.id, descendant.id));
      movedFolders++;
    }

    const affectedFolderIds = [folderId, ...descendants.map((descendant) => descendant.id)];
    for (const affectedFolderId of affectedFolderIds) {
      const folderFiles = await database.query.files.findMany({
        where: eq(files.folderId, affectedFolderId),
      });

      for (const file of folderFiles) {
        await database
          .update(files)
          .set({ path: file.path.replace(oldSlug, newSlug) })
          .where(eq(files.id, file.id));
        movedFiles++;
      }
    }

    if (exists(oldPath)) {
      await moveDir(oldPath, newPath);
    }

    await generatePreview(folderId);
    if (newParentId) {
      await generatePreview(newParentId);
    }
    if (folder.parentId) {
      await generatePreview(folder.parentId);
    }

    const updatedFolder = await database.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });

    return Result.ok({
      folder: updatedFolder,
      movedFolders,
      movedFiles,
    } satisfies MoveFolderOutput);
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function createFolderAndMoveChildren(
  name: string,
  parentId: string | null,
  childFolderIds: string[],
  deps: CreateFolderAndMoveDeps = {},
) {
  const database = deps.db ?? appDb;
  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const createId = deps.createId ?? nanoid;
  const ensureDir = deps.ensureDir ?? ensureUploadsDir;

  let parentSlug = "";
  if (parentId) {
    const parent = await database.query.folders.findFirst({
      where: eq(folders.id, parentId),
    });

    if (!parent) {
      return Result.err(new Error("Parent folder not found"));
    }

    parentSlug = parent.slug;
  }

  const baseSlug = cleanFolderSlug(name);
  if (!name.trim() || !baseSlug) {
    return Result.err(new Error("Name and slug are required"));
  }

  const newSlug = parentSlug ? `${parentSlug}/${baseSlug}` : baseSlug;
  const existing = await database.query.folders.findFirst({
    where: eq(folders.slug, newSlug),
  });

  if (existing) {
    return Result.err(new Error(`Folder "${newSlug}" already exists`));
  }

  const newFolderId = createId();
  await database.insert(folders).values({
    id: newFolderId,
    name,
    slug: newSlug,
    parentId,
  });
  await ensureDir(join(uploadsDir, newSlug));

  let totalMovedFolders = 1;
  let totalMovedFiles = 0;

  for (const childId of childFolderIds) {
    const moveResult = await moveFolder(childId, newFolderId, {
      ...deps,
      db: database,
      uploadsDir,
    });

    if (moveResult.isErr()) {
      return Result.err(moveResult.error);
    }

    totalMovedFolders += moveResult.value.movedFolders;
    totalMovedFiles += moveResult.value.movedFiles;
  }

  const newFolder = await database.query.folders.findFirst({
    where: eq(folders.id, newFolderId),
  });

  return Result.ok({
    folder: newFolder,
    movedFolders: totalMovedFolders,
    movedFiles: totalMovedFiles,
  } satisfies MoveFolderOutput);
}
