import type * as Route from "./types.ts";

import { requireCliAuth } from "#lib/cli-auth.server";
import {
  getVisibleBspFile,
  readBspAsset,
  resolveBspPalette,
  resolveBspWad,
} from "#lib/bsp-assets.server";

export async function wadLoader({
  request,
  params,
}: Route.LoaderArgsWithParams<{ fileId: string; wadName: string }>) {
  const user = await requireCliAuth(request);
  const bsp = await getVisibleBspFile(params.fileId, user);
  if (!bsp) return notFound();
  const wad = await resolveBspWad(bsp, params.wadName, user);
  return wad ? assetResponse(wad, "application/x-wad") : notFound();
}

export async function paletteLoader({
  request,
  params,
}: Route.LoaderArgsWithParams<{ fileId: string }>) {
  const user = await requireCliAuth(request);
  const bsp = await getVisibleBspFile(params.fileId, user);
  if (!bsp) return notFound();
  const palette = await resolveBspPalette(bsp, user);
  return palette ? assetResponse(palette, "application/octet-stream") : notFound();
}

async function assetResponse(
  file: Parameters<typeof readBspAsset>[0],
  contentType: string,
): Promise<Response> {
  const body = await readBspAsset(file);
  if (!body) return notFound();
  return new Response(Uint8Array.from(body), {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(body.length),
      "Content-Type": contentType,
    },
  });
}

function notFound(): Response {
  return new Response("BSP asset not found", { status: 404 });
}
