import type { Route } from "./+types/api.cli.folder.manage";
import { existsSync } from "fs";
import { count, eq, sql } from "drizzle-orm";
import { useLogger } from "evlog/react-router";
import { cleanFolderPath, cleanFolderSlug } from "@artbin/core/detection/filenames";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { requireCliAdmin } from "~/lib/cli-auth.server";
import { slugToPath } from "~/lib/files.server";
import { moveFolder, renameFolder } from "~/lib/folders.server";

type ManageFolderBody =
  | { operation: "rename"; slug: string; name: string; dryRun?: boolean }
  | { operation: "move"; slug: string; destinationSlug: string | null; dryRun?: boolean };

interface FolderImpact {
  folder: typeof folders.$inferSelect;
  descendantIds: string[];
  fileCount: number;
}

interface FolderPlan {
  operation: "rename" | "move";
  from: {
    id: string;
    name: string;
    slug: string;
    parentSlug: string | null;
  };
  to: {
    name: string;
    slug: string;
    parentSlug: string | null;
  };
  affected: {
    folders: number;
    files: number;
  };
  noOp: boolean;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function getFolderImpact(slug: string): Promise<FolderImpact | null> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });
  if (!folder) return null;

  const descendantPattern = `${escapeLike(slug)}/%`;
  const descendants = await db
    .select({ id: folders.id })
    .from(folders)
    .where(sql`${folders.slug} LIKE ${descendantPattern} ESCAPE '\\'`);
  const [{ value: affectedFiles }] = await db
    .select({ value: count() })
    .from(files)
    .where(sql`${files.path} LIKE ${descendantPattern} ESCAPE '\\'`);

  return {
    folder,
    descendantIds: descendants.map((descendant) => descendant.id),
    fileCount: affectedFiles,
  };
}

async function getParentSlug(parentId: string | null): Promise<string | null> {
  if (!parentId) return null;
  const parent = await db.query.folders.findFirst({
    where: eq(folders.id, parentId),
    columns: { slug: true },
  });
  return parent?.slug ?? null;
}

async function ensureSlugAvailable(newSlug: string, currentSlug: string): Promise<Response | null> {
  if (newSlug === currentSlug) return null;

  const collision = await db.query.folders.findFirst({
    where: eq(folders.slug, newSlug),
    columns: { id: true },
  });
  if (collision) {
    return Response.json({ error: `A folder already exists at "${newSlug}"` }, { status: 409 });
  }
  if (existsSync(slugToPath(newSlug))) {
    return Response.json({ error: `A directory already exists at "${newSlug}"` }, { status: 409 });
  }

  return null;
}

async function planRename(
  impact: FolderImpact,
  requestedName: string,
): Promise<FolderPlan | Response> {
  const name = requestedName.trim();
  const baseSlug = cleanFolderSlug(name);
  if (!name || !baseSlug) {
    return Response.json({ error: "A valid folder name is required" }, { status: 400 });
  }

  const parentSlug = await getParentSlug(impact.folder.parentId);
  const newSlug = parentSlug ? `${parentSlug}/${baseSlug}` : baseSlug;
  const collision = await ensureSlugAvailable(newSlug, impact.folder.slug);
  if (collision) return collision;

  const pathChanges = newSlug !== impact.folder.slug;
  const nameChanges = name !== impact.folder.name;
  return {
    operation: "rename",
    from: {
      id: impact.folder.id,
      name: impact.folder.name,
      slug: impact.folder.slug,
      parentSlug,
    },
    to: { name, slug: newSlug, parentSlug },
    affected: {
      folders: pathChanges ? 1 + impact.descendantIds.length : nameChanges ? 1 : 0,
      files: pathChanges ? impact.fileCount : 0,
    },
    noOp: !pathChanges && !nameChanges,
  };
}

async function planMove(
  impact: FolderImpact,
  requestedDestination: string | null,
): Promise<{ plan: FolderPlan; destinationId: string | null } | Response> {
  let destination: typeof folders.$inferSelect | null = null;
  if (requestedDestination !== null) {
    if (requestedDestination.startsWith("_")) {
      return Response.json(
        { error: "Cannot move a public folder into a system folder" },
        { status: 400 },
      );
    }
    const destinationSlug = cleanFolderPath(requestedDestination);
    if (!destinationSlug || destinationSlug !== requestedDestination) {
      return Response.json({ error: "A valid destination folder is required" }, { status: 400 });
    }
    destination =
      (await db.query.folders.findFirst({ where: eq(folders.slug, destinationSlug) })) ?? null;
    if (!destination) {
      return Response.json({ error: "Destination folder not found" }, { status: 404 });
    }
  }

  if (
    destination &&
    (destination.id === impact.folder.id || impact.descendantIds.includes(destination.id))
  ) {
    return Response.json(
      { error: "Cannot move a folder into itself or one of its descendants" },
      { status: 400 },
    );
  }

  const baseSlug = impact.folder.slug.split("/").pop()!;
  const newSlug = destination ? `${destination.slug}/${baseSlug}` : baseSlug;
  const collision = await ensureSlugAvailable(newSlug, impact.folder.slug);
  if (collision) return collision;

  const noOp = impact.folder.parentId === (destination?.id ?? null);
  return {
    destinationId: destination?.id ?? null,
    plan: {
      operation: "move",
      from: {
        id: impact.folder.id,
        name: impact.folder.name,
        slug: impact.folder.slug,
        parentSlug: await getParentSlug(impact.folder.parentId),
      },
      to: {
        name: impact.folder.name,
        slug: newSlug,
        parentSlug: destination?.slug ?? null,
      },
      affected: {
        folders: noOp ? 0 : 1 + impact.descendantIds.length,
        files: noOp ? 0 : impact.fileCount,
      },
      noOp,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const log = useLogger();
  const user = await requireCliAdmin(request);
  let body: ManageFolderBody;
  try {
    const input = (await request.json()) as Partial<ManageFolderBody> | null;
    if (
      !input ||
      (input.operation !== "rename" && input.operation !== "move") ||
      typeof input.slug !== "string" ||
      (input.dryRun !== undefined && typeof input.dryRun !== "boolean") ||
      (input.operation === "rename" && typeof input.name !== "string") ||
      (input.operation === "move" &&
        input.destinationSlug !== null &&
        typeof input.destinationSlug !== "string")
    ) {
      return Response.json({ error: "Invalid folder operation" }, { status: 400 });
    }
    body = input as ManageFolderBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.slug.startsWith("_")) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const slug = cleanFolderPath(body.slug);

  if (!slug || slug !== body.slug) {
    return Response.json({ error: "Invalid folder operation" }, { status: 400 });
  }

  const impact = await getFolderImpact(slug);
  if (!impact || impact.folder.slug.startsWith("_")) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  if (body.operation === "rename") {
    const plan = await planRename(impact, body.name ?? "");
    if (plan instanceof Response) return plan;

    log.set({
      cliFolderManage: {
        operation: "rename",
        userId: user.id,
        dryRun: !!body.dryRun,
        from: plan.from.slug,
        to: plan.to.slug,
        affectedFolders: plan.affected.folders,
        affectedFiles: plan.affected.files,
      },
    });
    if (body.dryRun || plan.noOp) {
      return Response.json({ success: true, dryRun: !!body.dryRun, plan });
    }

    const result = await renameFolder(impact.folder.id, plan.to.name);
    if (result.isErr()) {
      return Response.json({ error: result.error.message }, { status: 400 });
    }
    return Response.json({ success: true, dryRun: false, plan, result: result.value });
  }

  const move = await planMove(impact, body.destinationSlug);
  if (move instanceof Response) return move;

  log.set({
    cliFolderManage: {
      operation: "move",
      userId: user.id,
      dryRun: !!body.dryRun,
      from: move.plan.from.slug,
      to: move.plan.to.slug,
      affectedFolders: move.plan.affected.folders,
      affectedFiles: move.plan.affected.files,
    },
  });
  if (body.dryRun || move.plan.noOp) {
    return Response.json({ success: true, dryRun: !!body.dryRun, plan: move.plan });
  }

  const result = await moveFolder(impact.folder.id, move.destinationId);
  if (result.isErr()) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return Response.json({ success: true, dryRun: false, plan: move.plan, result: result.value });
}
