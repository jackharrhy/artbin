import type { Route } from "./+types/api.folder";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ensureDir, UPLOADS_DIR } from "~/lib/files.server";
import { join } from "path";

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { name, slug, parentId } = body;

  if (!name?.trim() || !slug?.trim()) {
    return Response.json({ error: "Name and slug are required" });
  }

  // Clean the slug
  const cleanSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleanSlug) {
    return Response.json({ error: "Invalid slug" });
  }

  // Build full slug if there's a parent
  let fullSlug = cleanSlug;
  if (parentId) {
    const parentFolder = await db.query.folders.findFirst({
      where: eq(folders.id, parentId),
    });
    if (!parentFolder) {
      return Response.json({ error: "Parent folder not found" });
    }
    fullSlug = `${parentFolder.slug}/${cleanSlug}`;
  }

  // Check for existing folder
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, fullSlug),
  });

  if (existing) {
    return Response.json({ error: `Folder "${fullSlug}" already exists` });
  }

  try {
    // Create the folder on disk
    const folderPath = join(UPLOADS_DIR, fullSlug);
    await ensureDir(folderPath);

    // Create database record
    const folderId = nanoid();
    await db.insert(folders).values({
      id: folderId,
      name: name.trim(),
      slug: fullSlug,
      parentId: parentId || null,
      ownerId: user.id,
    });

    return Response.json({
      folder: {
        id: folderId,
        name: name.trim(),
        slug: fullSlug,
      },
    });
  } catch (err) {
    console.error("Create folder error:", err);
    return Response.json({ error: `Failed to create folder: ${err}` });
  }
}
