import { redirect } from "react-router";

import { userContext } from "~/lib/auth-context.server";
import { getVisibleWADLibrary } from "~/lib/wad-assets.server";
import { getWADLibraryHref } from "~/lib/wad-paths";
import type { Route } from "./+types/wad.$fileId";

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  const library = await getVisibleWADLibrary(params.fileId, user);
  if (!library) throw new Response("WAD not found", { status: 404 });
  return redirect(getWADLibraryHref(library.file.path));
}
