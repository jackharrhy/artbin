import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { folders, files, users } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

// Mock fs/promises so saveFile doesn't touch the real filesystem
vi.mock("fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  };
});

// Mock child_process for ImageMagick (used by processImage/generatePreview/getImageDimensions)
vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    exec: vi.fn((_cmd: string, cb: Function) => {
      // Mock `magick identify` returning dimensions
      cb(null, { stdout: "128 128" }, "");
      return {};
    }),
  };
});

// Mock fs.existsSync for getUniqueFilename / needsPreview checks
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

import { exec } from "child_process";
import { ingestFile } from "~/lib/files.server";

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

const PNG_BUFFER = Buffer.from("fake-png-content");

describe("ingestFile", () => {
  test("saves file, detects kind/mime, hashes, and inserts DB record", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "wall.png",
      folderSlug: "textures",
      folderId: "folder-1",
      source: "upload",
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const r = result.value;
    expect(r.path).toBe("textures/wall.png");
    expect(r.name).toBe("wall.png");
    expect(r.kind).toBe("texture");
    expect(r.mimeType).toBe("image/png");
    expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(r.fileId).toBeTruthy();

    // Verify DB record was created
    const record = await db.query.files.findFirst({
      where: eq(files.id, r.fileId),
    });
    expect(record).toBeDefined();
    expect(record!.path).toBe("textures/wall.png");
    expect(record!.name).toBe("wall.png");
    expect(record!.kind).toBe("texture");
    expect(record!.source).toBe("upload");
    expect(record!.size).toBe(PNG_BUFFER.length);
    expect(record!.status).toBe("approved");
  });

  test("pending status and suggestedFolderId are stored", async () => {
    const db = setupDatabase();
    await db.insert(folders).values([
      { id: "folder-1", name: "Inbox", slug: "inbox" },
      { id: "folder-2", name: "Textures", slug: "textures" },
    ]);

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "wall.png",
      folderSlug: "inbox",
      folderId: "folder-1",
      source: "upload",
      status: "pending",
      suggestedFolderId: "folder-2",
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const record = await db.query.files.findFirst({
      where: eq(files.id, result.value.fileId),
    });
    expect(record!.status).toBe("pending");
    expect(record!.suggestedFolderId).toBe("folder-2");
  });

  test("processImages: false skips image processing", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "wall.png",
      folderSlug: "textures",
      folderId: "folder-1",
      source: "upload",
      processImages: false,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.width).toBeNull();
    expect(result.value.height).toBeNull();
    expect(result.value.hasPreview).toBe(false);

    // exec should NOT have been called (no ImageMagick invocations)
    expect(exec).not.toHaveBeenCalled();
  });

  test("processImages: false still generates preview for non-web-native formats", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "wall.tga",
      folderSlug: "textures",
      folderId: "folder-1",
      source: "cli-upload",
      processImages: false,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Preview should be generated even with processImages: false
    // because browsers cannot render TGA files natively
    expect(result.value.hasPreview).toBe(true);

    // But dimensions should still be skipped (the perf optimization)
    expect(result.value.width).toBeNull();
    expect(result.value.height).toBeNull();

    // exec should have been called once (for magick convert, not magick identify)
    expect(exec).toHaveBeenCalledTimes(1);
    const call = (exec as any).mock.calls[0][0];
    expect(call).toContain("magick");
    expect(call).toContain("wall.tga");
    expect(call).toContain(".preview.png");

    // DB record should have hasPreview = true
    const record = await db.query.files.findFirst({
      where: eq(files.id, result.value.fileId),
    });
    expect(record!.hasPreview).toBe(true);
  });

  test("pre-computed kind, mimeType, width, height skip detection", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "custom.dat",
      folderSlug: "textures",
      folderId: "folder-1",
      source: "extracted-pk3",
      kind: "texture",
      mimeType: "image/x-custom",
      width: 256,
      height: 512,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.kind).toBe("texture");
    expect(result.value.mimeType).toBe("image/x-custom");
    expect(result.value.width).toBe(256);
    expect(result.value.height).toBe(512);
    // With pre-computed dimensions, processImage should be skipped entirely
    expect(exec).not.toHaveBeenCalled();
  });

  test("uploaderId and sourceArchive are stored", async () => {
    const db = setupDatabase();
    await db.insert(users).values({
      id: "user-42",
      username: "testuser",
      fourmId: "fourm-42",
    });
    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "wall.png",
      folderSlug: "textures",
      folderId: "folder-1",
      source: "extracted-pk3",
      uploaderId: "user-42",
      sourceArchive: "textures.pk3",
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const record = await db.query.files.findFirst({
      where: eq(files.id, result.value.fileId),
    });
    expect(record!.uploaderId).toBe("user-42");
    expect(record!.sourceArchive).toBe("textures.pk3");
  });

  test("folder fileCount is incremented", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
      fileCount: 5,
    });

    const result = await ingestFile({
      buffer: PNG_BUFFER,
      fileName: "wall.png",
      folderSlug: "textures",
      folderId: "folder-1",
      source: "upload",
    });

    expect(result.isOk()).toBe(true);

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(folder!.fileCount).toBe(6);
  });
});
