import type { Route } from "./+types/api.lucky";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "~/db/connection.server";
import { files, folders } from "~/db";
import { getUserFromRequest } from "~/lib/auth.server";
import { getDescendantFolderIds } from "~/lib/file-queries.server";

async function findRandomFilePath(folderIds?: string[], excludePath?: string) {
  const conditions = [eq(files.status, "approved")];
  if (folderIds) conditions.push(inArray(files.folderId, folderIds));
  if (excludePath) conditions.push(ne(files.path, excludePath));

  const [randomFile] = await db
    .select({ path: files.path })
    .from(files)
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  return randomFile?.path;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const folderIdValue = formData.get("folderId");
  const excludePathValue = formData.get("excludePath");
  const folderId = typeof folderIdValue === "string" && folderIdValue ? folderIdValue : undefined;
  const excludePath =
    typeof excludePathValue === "string" && excludePathValue ? excludePathValue : undefined;

  let folderIds: string[] | undefined;
  if (folderId) {
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
      columns: { id: true },
    });
    if (!folder) {
      return Response.json({ error: "Folder not found" }, { status: 404 });
    }
    folderIds = await getDescendantFolderIds(folder.id);
  }

  let path = await findRandomFilePath(folderIds, excludePath);
  if (!path && excludePath) {
    path = await findRandomFilePath(folderIds);
  }

  if (!path) {
    return Response.json({ error: "No assets found" }, { status: 404 });
  }

  return Response.json({ path });
}
