import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vitest";
import { runImport } from "../src/lib/importer.ts";
import type { ApiClient } from "../src/lib/api.ts";
import type { ScanResult } from "../src/lib/scanner.ts";

test("normalizes Windows paths and reports failed uploads after finalizing successful files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-import-test-"));
  try {
    const path = join(directory, "wall.txt");
    await writeFile(path, "texture");
    const scanResult = {
      archives: [],
      looseFiles: [
        { path, relativePath: "textures\\wall.txt", name: "wall.txt", size: 7, gameDir: null },
        { path, relativePath: "textures\\bad.txt", name: "bad.txt", size: 7, gameDir: null },
      ],
      totalFileCount: 2,
      totalSize: 14,
    } as ScanResult;
    const api = {
      createFolders: vi.fn(async () => ({})),
      checkManifest: vi.fn(async () => ({
        newFiles: ["textures/wall.txt", "textures/bad.txt"],
        existingFiles: [],
      })),
      uploadFile: vi.fn(async (_root, file) => {
        if (file.path.endsWith("bad.txt")) throw new Error("Checksum mismatch");
      }),
      finalize: vi.fn(async () => ({ finalized: 2 })),
    };
    await expect(
      runImport({ scanResult, api: api as unknown as ApiClient, rootSlug: "game" }),
    ).rejects.toThrow("textures/bad.txt: Checksum mismatch");
    expect(api.createFolders).toHaveBeenCalledWith([
      { slug: "game", name: "game", parentSlug: null },
      { slug: "game/textures", name: "textures", parentSlug: "game" },
    ]);
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    expect(api.finalize).toHaveBeenCalledWith("game");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
