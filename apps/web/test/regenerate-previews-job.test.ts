import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

import { files, folders, jobs } from "#db";
import { setDbForTesting } from "#db/connection.server";

import { applyMigrations, createTestDatabase, type TestDatabase } from "./db.ts";

const generateBspDerivatives = vi.fn(async () => ({
  png: Buffer.from("overview-png"),
  walkabilityJson: '{"format":"worldview-walkability"}',
  usedWalkability: true,
  warnings: [],
}));
const writeFile = vi.fn(async () => {});
const rename = vi.fn(async () => {});

vi.mock("#lib/bsp-overview-renderer.server", () => ({ generateBspDerivatives }));
vi.mock("#lib/folder-preview.server", () => ({
  generateFolderPreview: vi.fn(async () => null),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(() => true),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  rename,
  unlink: vi.fn(async () => {}),
  writeFile,
}));
vi.mock("fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs/promises")>()),
  rename,
  unlink: vi.fn(async () => {}),
  writeFile,
}));

const { handleRegeneratePreviews } =
  await import("../src/lib/jobs/regenerate-previews-job.server.ts");
const { createJob, processJob } = await import("#lib/jobs.server");

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
  vi.clearAllMocks();
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

describe("preview regeneration job", () => {
  test("renders an approved BSP before refreshing folder previews", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    await db.insert(files).values({
      id: "map",
      path: "maps/example.bsp",
      name: "example.bsp",
      mimeType: "application/octet-stream",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
      hasPreview: false,
    });
    await db.insert(files).values({
      id: "other-map",
      path: "maps/other.bsp",
      name: "other.bsp",
      mimeType: "application/octet-stream",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
      hasPreview: false,
    });
    const target = { scope: "file" as const, fileId: "map" };
    const input = {
      userId: "admin",
      target,
    };
    const job = await createJob({ type: "regenerate-previews", input });

    const result = await handleRegeneratePreviews(job, input);

    expect(generateBspDerivatives).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.preview\.png\.tmp-.+$/),
      Buffer.from("overview-png"),
    );
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.preview\.png\.tmp-.+$/),
      expect.stringMatching(/example\.bsp\.preview\.png$/),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/example\.worldview-walkability\.json\.tmp-.+$/),
      '{"format":"worldview-walkability"}',
    );
    expect(result.mapPreviews).toBe(1);
    const updated = await db.query.files.findFirst({ where: eq(files.id, "map") });
    expect(updated?.hasPreview).toBe(true);
    const untouched = await db.query.files.findFirst({ where: eq(files.id, "other-map") });
    expect(untouched?.hasPreview).toBe(false);
  });

  test("fails with the target path when a BSP preview cannot be generated", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    await db.insert(files).values({
      id: "map",
      path: "maps/broken.bsp",
      name: "broken.bsp",
      mimeType: "application/octet-stream",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
      hasPreview: false,
    });
    generateBspDerivatives.mockRejectedValueOnce(new Error("renderer unavailable"));
    const input = {
      userId: "admin",
      target: { scope: "file" as const, fileId: "map" },
    };
    const job = await createJob({ type: "regenerate-previews", input });

    const result = await processJob(job);

    expect(result.isErr()).toBe(true);
    const failedJob = await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) });
    expect(failedJob).toMatchObject({
      status: "failed",
      error: expect.stringContaining("map maps/broken.bsp: renderer unavailable"),
    });
    const unchanged = await db.query.files.findFirst({ where: eq(files.id, "map") });
    expect(unchanged?.hasPreview).toBe(false);
  });
});
