import type { Route } from "./+types/api.cli.folders";
import { requireCliAdmin } from "~/lib/cli-auth.server";
import { db } from "~/db/connection.server";
import { folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cleanFolderSlug } from "@artbin/core/detection/filenames";
import { ensureDir, slugToPath } from "~/lib/files.server";

interface FolderInput {
  slug: string;
  name: string;
  parentSlug?: string;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCliAdmin(request);

  const body = (await request.json()) as { folders: FolderInput[] };

  const created: { slug: string; id: string }[] = [];
  const existing: { slug: string; id: string }[] = [];

  for (const input of body.folders) {
    const slug = cleanFolderSlug(input.slug);
    if (!slug) continue;

    // Check if folder already exists
    const found = await db.query.folders.findFirst({
      where: eq(folders.slug, slug),
    });

    if (found) {
      existing.push({ slug: found.slug, id: found.id });
      continue;
    }

    // Look up parent if parentSlug provided
    let parentId: string | null = null;
    if (input.parentSlug) {
      const parentSlug = cleanFolderSlug(input.parentSlug);
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

  return Response.json({ created, existing });
}
