import type * as Route from "./types.ts";
import { createRequestLogger } from "evlog";
import { requireCliAuth } from "#lib/cli-auth.server";
import { db } from "#db/connection.server";
import { folders, remoteImports } from "#db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cleanFolderPath } from "@artbin/core/detection/filenames";
import { ensureDir, slugToPath } from "#lib/files.server";

interface FolderInput {
  slug: string;
  name: string;
  parentSlug?: string;
}

interface FolderSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  parentSlug: string | null;
  fileCount: number;
  childCount: number;
  descendantCount: number;
  totalFileCount: number;
  createdAt: Date | null;
}

function isSystemFolder(slug: string): boolean {
  return slug.startsWith("_");
}

function summarizeFolders(allFolders: (typeof folders.$inferSelect)[]): FolderSummary[] {
  const byId = new Map(allFolders.map((folder) => [folder.id, folder]));
  const childCounts = new Map<string, number>();
  const totals = new Map(
    allFolders.map((folder) => [
      folder.id,
      { descendantCount: 0, totalFileCount: folder.fileCount ?? 0 },
    ]),
  );

  for (const folder of allFolders) {
    if (folder.parentId && byId.has(folder.parentId)) {
      childCounts.set(folder.parentId, (childCounts.get(folder.parentId) ?? 0) + 1);
    }
  }

  const deepestFirst = [...allFolders].sort(
    (a, b) => b.slug.split("/").length - a.slug.split("/").length,
  );
  for (const folder of deepestFirst) {
    if (!folder.parentId || !byId.has(folder.parentId)) continue;
    const childTotal = totals.get(folder.id)!;
    const parentTotal = totals.get(folder.parentId)!;
    parentTotal.descendantCount += 1 + childTotal.descendantCount;
    parentTotal.totalFileCount += childTotal.totalFileCount;
  }

  return allFolders
    .map((folder) => {
      const total = totals.get(folder.id)!;

      return {
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        description: folder.description,
        parentId: folder.parentId,
        parentSlug: folder.parentId ? (byId.get(folder.parentId)?.slug ?? null) : null,
        fileCount: folder.fileCount ?? 0,
        childCount: childCounts.get(folder.id) ?? 0,
        descendantCount: total.descendantCount,
        totalFileCount: total.totalFileCount,
        createdAt: folder.createdAt,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCliAuth(request);
  const url = new URL(request.url);
  const requestedSlug = url.searchParams.get("slug");
  const includeSystem = url.searchParams.get("includeSystem") === "true" && user.isAdmin;

  const storedFolders = await db.query.folders.findMany({
    orderBy: [folders.slug],
  });
  const visibleFolders = includeSystem
    ? storedFolders
    : storedFolders.filter((folder) => !isSystemFolder(folder.slug));
  const summaries = summarizeFolders(visibleFolders);

  if (!requestedSlug) {
    return Response.json({ folders: summaries });
  }

  const slug = cleanFolderPath(requestedSlug);
  if (!slug) {
    return Response.json({ error: "Invalid folder slug" }, { status: 400 });
  }

  const folder = storedFolders.find((candidate) => candidate.slug === slug);
  if (!folder || (isSystemFolder(folder.slug) && !user.isAdmin)) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const detailSummaries = summarizeFolders(
    user.isAdmin
      ? storedFolders
      : storedFolders.filter((candidate) => !isSystemFolder(candidate.slug)),
  );
  const summary = detailSummaries.find((candidate) => candidate.id === folder.id)!;
  const children = detailSummaries.filter((candidate) => candidate.parentId === folder.id);
  const source = await db.query.remoteImports.findFirst({
    where: eq(remoteImports.folderId, folder.id),
    orderBy: (imports, { desc }) => [desc(imports.updatedAt)],
    columns: {
      provider: true,
      externalId: true,
      sourceUrl: true,
      title: true,
      author: true,
      game: true,
    },
  });

  return Response.json({
    folder: {
      ...summary,
      children,
      source: source ?? null,
    },
  });
}

export async function action({ request }: Route.ActionArgs) {
  const log = createRequestLogger();
  const user = await requireCliAuth(request);

  const body = (await request.json()) as { folders: FolderInput[] };
  log.set({
    cliFolders: { userId: user.id, isAdmin: user.isAdmin, inputCount: body.folders.length },
  });

  const created: { slug: string; id: string }[] = [];
  const existing: { slug: string; id: string }[] = [];

  for (const input of body.folders) {
    const slug = cleanFolderPath(input.slug);
    if (!slug) continue;

    // Check if folder already exists
    const found = await db.query.folders.findFirst({
      where: eq(folders.slug, slug),
    });

    if (found) {
      existing.push({ slug: found.slug, id: found.id });
      continue;
    }

    // Non-admin users can only read existing folders, not create new ones
    if (!user.isAdmin) {
      continue;
    }

    // Look up parent if parentSlug provided
    let parentId: string | null = null;
    if (input.parentSlug) {
      const parentSlug = cleanFolderPath(input.parentSlug);
      const parent = await db.query.folders.findFirst({
        where: eq(folders.slug, parentSlug),
      });
      if (parent) {
        parentId = parent.id;
      }
    }

    // Create disk directory
    await ensureDir(slugToPath(slug));

    // Insert folder record
    const id = nanoid();
    await db.insert(folders).values({
      id,
      name: input.name,
      slug,
      parentId,
      ownerId: user.id,
    });

    created.push({ slug, id });
  }

  log.set({ cliFolders: { createdCount: created.length, existingCount: existing.length } });
  return Response.json({ created, existing });
}
