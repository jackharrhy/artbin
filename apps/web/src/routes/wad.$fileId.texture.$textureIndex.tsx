import { redirect } from "react-router";

import { userContext } from "~/lib/auth-context.server";
import { getVisibleWADLibrary } from "~/lib/wad-assets.server";
import { getWADTextureHref } from "~/lib/wad-paths";
import type { Route } from "./+types/wad.$fileId.texture.$textureIndex";

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  const library = await getVisibleWADLibrary(params.fileId, user);
  if (!library) throw new Response("WAD not found", { status: 404 });

  const textureIndex = Number(params.textureIndex);
  const texture = library.contents.textures.find((entry) => entry.index === textureIndex);
  if (!texture) throw new Response("Texture not found", { status: 404 });

  return redirect(getWADTextureHref(library.file.path, texture, library.contents.textures));
}
