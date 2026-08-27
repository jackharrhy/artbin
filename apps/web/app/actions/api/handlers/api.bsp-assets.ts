import type * as Route from "./types.ts";

import { redirect } from "remix/response/redirect";

import { requireCliAuth } from "#lib/cli-auth.server";
import { getVisibleBspFile, resolveBspPalette, resolveBspWad } from "#lib/bsp-assets.server";

import { mediaFileHref } from "../../../routes.ts";

export async function wadLoader({
  request,
  params,
}: Route.LoaderArgsWithParams<{ fileId: string; wadName: string }>) {
  const user = await requireCliAuth(request);
  const bsp = await getVisibleBspFile(params.fileId, user);
  if (!bsp) return notFound();
  const wad = await resolveBspWad(bsp, params.wadName, user);
  return wad ? redirect(mediaFileHref(wad), 302) : notFound();
}

export async function paletteLoader({
  request,
  params,
}: Route.LoaderArgsWithParams<{ fileId: string }>) {
  const user = await requireCliAuth(request);
  const bsp = await getVisibleBspFile(params.fileId, user);
  if (!bsp) return notFound();
  const palette = await resolveBspPalette(bsp, user);
  return palette ? redirect(mediaFileHref(palette), 302) : notFound();
}

function notFound(): Response {
  return new Response("BSP asset not found", { status: 404 });
}
