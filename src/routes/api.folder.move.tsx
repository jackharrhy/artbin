import type { Route } from "./+types/api.folder.move";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { moveFolder, createFolderAndMoveChildren } from "~/lib/folder-ops.server";

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // Move a single folder to a new parent
  if (actionType === "move") {
    const folderId = formData.get("folderId") as string;
    const newParentId = formData.get("newParentId") as string | null;

    if (!folderId) {
      return Response.json({ error: "Missing folderId" }, { status: 400 });
    }

    // Convert empty string to null for root-level moves
    const parentId = newParentId === "" || newParentId === "root" ? null : newParentId;

    const result = await moveFolder(folderId, parentId);

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      success: true,
      folder: result.folder,
      movedFolders: result.movedFolders,
      movedFiles: result.movedFiles,
    });
  }

  // Create a new folder and move multiple folders into it
  if (actionType === "create-and-move") {
    const name = formData.get("name") as string;
    const parentId = formData.get("parentId") as string | null;
    const childIdsJson = formData.get("childFolderIds") as string;

    if (!name) {
      return Response.json({ error: "Missing folder name" }, { status: 400 });
    }

    let childFolderIds: string[] = [];
    if (childIdsJson) {
      try {
        childFolderIds = JSON.parse(childIdsJson);
      } catch {
        return Response.json({ error: "Invalid childFolderIds format" }, { status: 400 });
      }
    }

    // Convert empty string to null for root-level
    const effectiveParentId = parentId === "" || parentId === "root" ? null : parentId;

    const result = await createFolderAndMoveChildren(name, effectiveParentId, childFolderIds);

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      success: true,
      folder: result.folder,
      movedFolders: result.movedFolders,
      movedFiles: result.movedFiles,
    });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
