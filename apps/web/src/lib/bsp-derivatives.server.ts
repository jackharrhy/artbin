import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import { parseBsp } from "@jackharrhy/worldview/core";
import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

const uploadsDirectory = resolve(
  process.env.ARTBIN_PUBLIC_DIR ?? join(process.cwd(), "public"),
  "uploads",
);

export interface BspDependencyManifest {
  version: 1;
  wads: string[];
}

export function getBspDependencyPath(filePath: string): string {
  return siblingPath(filePath, ".artbin-bsp.json");
}

export function getBspWalkabilityPath(filePath: string): string {
  return siblingPath(filePath, ".worldview-walkability.json");
}

export function hasBspWalkability(filePath: string): boolean {
  return existsSync(getBspWalkabilityPath(filePath));
}

export function inspectBspDependencies(
  bytes: ArrayBuffer | ArrayBufferView,
): BspDependencyManifest {
  const world = parseBsp(bytes);
  return {
    version: 1,
    wads: [...new Set(world.wadReferences.map((reference) => reference.basename.toLowerCase()))],
  };
}

export async function writeBspDependencyManifest(filePath: string, bytes: ArrayBufferView) {
  const manifest = inspectBspDependencies(bytes);
  await writeDerivedFile(getBspDependencyPath(filePath), JSON.stringify(manifest));
  return manifest;
}

export async function refreshBspDependencyManifest(filePath: string, bytes: ArrayBufferView) {
  try {
    return await writeBspDependencyManifest(filePath, bytes);
  } catch {
    await unlink(getBspDependencyPath(filePath)).catch(() => {});
    return null;
  }
}

export async function readBspDependencyManifest(
  filePath: string,
): Promise<BspDependencyManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(getBspDependencyPath(filePath), "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { wads?: unknown }).wads) ||
      !(parsed as { wads: unknown[] }).wads.every((name) => typeof name === "string")
    ) {
      return null;
    }
    return parsed as BspDependencyManifest;
  } catch {
    return null;
  }
}

export async function writeDerivedFile(path: string, contents: string | Uint8Array): Promise<void> {
  const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function siblingPath(filePath: string, suffix: string): string {
  const file = parse(filePath);
  const target = resolve(uploadsDirectory, dirname(filePath), `${file.name}${suffix}`);
  const relativePath = relative(uploadsDirectory, target);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Invalid BSP derivative path");
  }
  return target;
}
