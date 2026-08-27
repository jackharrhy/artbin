import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { and, eq, or, sql } from "drizzle-orm";

import type { User } from "#db";
import { files } from "#db";
import { db } from "#db/connection.server";
import { getFilePath } from "#lib/files.server";

type AssetFile = typeof files.$inferSelect;

export interface BspAsset {
  readonly path: string;
  readonly absolutePath: string;
}

const providedAssetRoot = "_provided";

export async function getVisibleBspFile(fileId: string, user: User): Promise<AssetFile | null> {
  const file = await db.query.files.findFirst({ where: eq(files.id, fileId) });
  return file && isVisible(file, user) && file.name.toLowerCase().endsWith(".bsp") ? file : null;
}

export async function resolveBspWad(
  bsp: AssetFile,
  requestedName: string,
  user: User,
): Promise<BspAsset | null> {
  if (!isSafeLeafName(requestedName) || !requestedName.toLowerCase().endsWith(".wad")) return null;
  const candidates = (await findVisibleNamedFiles(requestedName, user)).map(uploadAsset);
  return selectBspAsset(bsp.path, candidates);
}

export async function resolveBspPalette(bsp: AssetFile, user: User): Promise<BspAsset | null> {
  const candidates = (await findVisibleNamedFiles("palette.lmp", user)).map(uploadAsset);
  return selectBspAsset(bsp.path, candidates);
}

export async function readBspAsset(file: BspAsset): Promise<Buffer | null> {
  try {
    return await readFile(file.absolutePath);
  } catch {
    return null;
  }
}

export function selectBspAsset<T extends Pick<AssetFile, "path">>(
  bspPath: string,
  candidates: readonly T[],
): T | null {
  let selected: T | null = null;
  let selectedScore = -1;
  for (const candidate of candidates) {
    const score = assetScore(bspPath, candidate.path);
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return selected;
}

function assetScore(bspPath: string, candidatePath: string): number {
  const bspDirectory = pathParts(dirname(bspPath));
  const candidateDirectory = pathParts(dirname(candidatePath));
  const provided = candidateDirectory[0]?.toLowerCase() === providedAssetRoot.toLowerCase();
  let common = 0;
  while (
    common < bspDirectory.length &&
    common < candidateDirectory.length &&
    bspDirectory[common]!.toLowerCase() === candidateDirectory[common]!.toLowerCase()
  ) {
    common += 1;
  }

  // Nearby assets must share their top-level imported collection. Curated assets are the fallback.
  if (common === 0)
    return provided ? 100 + providedGameScore(bspDirectory, candidateDirectory) : -1;
  const distance = bspDirectory.length + candidateDirectory.length - common * 2;
  return 1_000 + common * 100 - distance;
}

function providedGameScore(bspPath: readonly string[], candidatePath: readonly string[]): number {
  const bspSegments = new Set(bspPath.map((segment) => segment.toLowerCase()));
  const candidateSegments = new Set(candidatePath.map((segment) => segment.toLowerCase()));
  const families = [
    { map: ["cstrike"], provided: "cstrike" },
    { map: ["id1", "quake"], provided: "quake" },
    { map: ["valve", "gearbox", "tfc", "dmc", "ricochet", "goldsrc"], provided: "goldsrc" },
  ];
  return families.some(
    (family) =>
      candidateSegments.has(family.provided) &&
      family.map.some((segment) => bspSegments.has(segment)),
  )
    ? 50
    : 0;
}

function pathParts(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter(Boolean);
}

function isSafeLeafName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && basename(name) === name && !name.includes("\\");
}

function isVisible(file: AssetFile, user: User): boolean {
  return file.status === "approved" || file.uploaderId === user.id || Boolean(user.isAdmin);
}

async function findVisibleNamedFiles(name: string, user: User): Promise<AssetFile[]> {
  const visibility = user.isAdmin
    ? undefined
    : or(eq(files.status, "approved"), eq(files.uploaderId, user.id));
  return db.query.files.findMany({
    where: and(sql`lower(${files.name}) = lower(${name})`, visibility),
  });
}

function uploadAsset(file: AssetFile): BspAsset {
  return { path: file.path, absolutePath: getFilePath(file.path) };
}
