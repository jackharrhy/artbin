import type { WADTextureInfo } from "@artbin/core/parsers/wad";

function encodeAssetPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function getWADLibraryHref(filePath: string): string {
  return `/folder/${encodeAssetPath(filePath)}`;
}

export function getWADTextureFilename(texture: WADTextureInfo, textures: WADTextureInfo[]): string {
  const hasDuplicateName = textures.some(
    (candidate) =>
      candidate.index !== texture.index &&
      candidate.name.toLowerCase() === texture.name.toLowerCase(),
  );
  const suffix = hasDuplicateName ? `~${texture.index}` : "";
  return `${texture.name}${suffix}.png`;
}

export function getWADTextureHref(
  filePath: string,
  texture: WADTextureInfo,
  textures: WADTextureInfo[],
): string {
  const filename = getWADTextureFilename(texture, textures);
  return `/file/${encodeAssetPath(filePath)}/${encodeURIComponent(filename)}`;
}

export function splitWADTexturePath(path: string):
  | {
      wadPath: string;
      textureFilename: string;
    }
  | undefined {
  const boundary = path.toLowerCase().lastIndexOf(".wad/");
  if (boundary === -1) return undefined;

  const wadPath = path.slice(0, boundary + ".wad".length);
  const textureFilename = path.slice(boundary + ".wad/".length);
  if (!wadPath || !textureFilename || textureFilename.includes("/")) return undefined;
  return { wadPath, textureFilename };
}
