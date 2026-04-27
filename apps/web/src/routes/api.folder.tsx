import type { Route } from "./+types/api.folder";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { createFolder } from "~/lib/folders.server";

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { name, slug, parentId } = body;

  try {
    const result = await createFolder({
      name,
      slug,
      parentId: parentId || null,
      ownerId: user.id,
    });

    if (result.isErr()) {
      return Response.json({ error: result.error.message });
    }

    return Response.json({
      folder: result.value,
    });
  } catch (err) {
    console.error("Create folder error:", err);
    return Response.json({ error: `Failed to create folder: ${err}` });
  }
}
