import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { files, folders, users } from "~/db/schema";
import { setDbForTesting } from "~/db";
import { createFolder, createFolderAndMoveChildren, moveFolder } from "~/lib/folders.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

async function seedUser(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "user-1",
    email: "user@example.com",
    username: "user",
    passwordHash: "hash",
  });
}

describe("createFolder", () => {
  test("creates a root folder with a cleaned slug and directory path", async () => {
    const db = setupDatabase();
    const createdDirs: string[] = [];
    await seedUser(db);

    const result = await createFolder(
      { name: "  Wall Textures  ", slug: "Wall Textures!!!", parentId: null, ownerId: "user-1" },
      {
        createId: () => "folder-1",
        uploadsDir: "/uploads-test",
        ensureDir: async (path) => {
          createdDirs.push(path);
        },
      },
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      id: "folder-1",
      name: "Wall Textures",
      slug: "wall-textures",
    });
    expect(createdDirs).toEqual(["/uploads-test/wall-textures"]);

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(folder?.slug).toBe("wall-textures");
    expect(folder?.ownerId).toBe("user-1");
  });

  test("creates a child folder under the parent slug", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values({
      id: "parent-1",
      name: "Parent",
      slug: "parent",
    });

    const result = await createFolder(
      { name: "Child", slug: "Child", parentId: "parent-1", ownerId: "user-1" },
      {
        createId: () => "child-1",
        uploadsDir: "/uploads-test",
        ensureDir: async () => {},
      },
    );

    expect(result.unwrap().slug).toBe("parent/child");
  });

  test("returns an error when creating the directory fails", async () => {
    const db = setupDatabase();
    await seedUser(db);

    const result = await createFolder(
      { name: "Textures", slug: "textures", parentId: null, ownerId: "user-1" },
      {
        createId: () => "folder-1",
        uploadsDir: "/uploads-test",
        ensureDir: async () => {
          throw new Error("disk is full");
        },
      },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected folder creation to fail");
    expect(result.error.message).toBe("disk is full");
  });

  test("rejects duplicate folder slugs", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values({
      id: "existing-1",
      name: "Existing",
      slug: "textures",
    });

    const result = await createFolder(
      { name: "Textures", slug: "textures", parentId: null, ownerId: "user-1" },
      {
        createId: () => "folder-1",
        uploadsDir: "/uploads-test",
        ensureDir: async () => {},
      },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected duplicate folder creation to fail");
    expect(result.error.message).toBe('Folder "textures" already exists');
  });
});

describe("moveFolder", () => {
  test("returns an error when the folder does not exist", async () => {
    setupDatabase();

    const result = await moveFolder("missing", null, {
      exists: () => false,
      rename: async () => {},
      ensureDir: async () => {},
      generatePreview: async () => null,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected missing folder move to fail");
    expect(result.error.message).toBe("Folder not found");
  });

  test("returns an error when the parent folder does not exist", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Folder",
      slug: "folder",
    });

    const result = await moveFolder("folder-1", "missing-parent", {
      exists: () => false,
      rename: async () => {},
      ensureDir: async () => {},
      generatePreview: async () => null,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected missing parent move to fail");
    expect(result.error.message).toBe("Parent folder not found");
  });

  test("prevents moving a folder into its descendant", async () => {
    const db = setupDatabase();

    await db.insert(folders).values([
      { id: "parent", name: "Parent", slug: "parent" },
      { id: "child", name: "Child", slug: "parent/child", parentId: "parent" },
    ]);

    const result = await moveFolder("parent", "child", {
      exists: () => false,
      rename: async () => {},
      ensureDir: async () => {},
      generatePreview: async () => null,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected descendant move to fail");
    expect(result.error.message).toBe("Cannot move folder into its own descendant");
  });

  test("updates folder slugs and file paths when moving into a new parent", async () => {
    const db = setupDatabase();
    const renamed: Array<[string, string]> = [];
    const previewed: string[] = [];

    await db.insert(folders).values([
      { id: "target", name: "Target", slug: "target" },
      { id: "source", name: "Source", slug: "source" },
      { id: "child", name: "Child", slug: "source/child", parentId: "source" },
    ]);
    await db.insert(files).values([
      {
        id: "file-1",
        path: "source/root.png",
        name: "root.png",
        mimeType: "image/png",
        size: 10,
        kind: "texture",
        folderId: "source",
      },
      {
        id: "file-2",
        path: "source/child/nested.png",
        name: "nested.png",
        mimeType: "image/png",
        size: 20,
        kind: "texture",
        folderId: "child",
      },
    ]);

    const result = await moveFolder("source", "target", {
      uploadsDir: "/uploads-test",
      exists: (path) => path === "/uploads-test/source",
      rename: async (from, to) => {
        renamed.push([from, to]);
      },
      ensureDir: async () => {},
      generatePreview: async (folderId) => {
        previewed.push(folderId);
        return null;
      },
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({ movedFolders: 2, movedFiles: 2 });
    expect(renamed).toEqual([["/uploads-test/source", "/uploads-test/target/source"]]);
    expect(previewed).toEqual(["source", "target"]);

    const movedSource = await db.query.folders.findFirst({ where: eq(folders.id, "source") });
    const movedChild = await db.query.folders.findFirst({ where: eq(folders.id, "child") });
    const rootFile = await db.query.files.findFirst({ where: eq(files.id, "file-1") });
    const nestedFile = await db.query.files.findFirst({ where: eq(files.id, "file-2") });

    expect(movedSource?.parentId).toBe("target");
    expect(movedSource?.slug).toBe("target/source");
    expect(movedChild?.slug).toBe("target/source/child");
    expect(rootFile?.path).toBe("target/source/root.png");
    expect(nestedFile?.path).toBe("target/source/child/nested.png");
  });

  test("returns an error when moving the directory fails", async () => {
    const db = setupDatabase();

    await db.insert(folders).values([
      { id: "source", name: "Source", slug: "source" },
      { id: "target", name: "Target", slug: "target" },
    ]);

    const result = await moveFolder("source", "target", {
      uploadsDir: "/uploads-test",
      exists: (path) => path === "/uploads-test/source",
      rename: async () => {
        throw new Error("permission denied");
      },
      ensureDir: async () => {},
      generatePreview: async () => null,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected folder move to fail");
    expect(result.error.message).toBe("permission denied");
  });
});

describe("createFolderAndMoveChildren", () => {
  test("creates a folder and moves selected children into it", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "child-a", name: "Child A", slug: "child-a" },
      { id: "child-b", name: "Child B", slug: "child-b" },
    ]);

    const result = await createFolderAndMoveChildren("Group", null, ["child-a", "child-b"], {
      createId: () => "group",
      uploadsDir: "/uploads-test",
      exists: (path) => path === "/uploads-test/child-a" || path === "/uploads-test/child-b",
      rename: async () => {},
      ensureDir: async () => {},
      generatePreview: async () => null,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({ movedFolders: 3, movedFiles: 0 });

    const childA = await db.query.folders.findFirst({ where: eq(folders.id, "child-a") });
    const childB = await db.query.folders.findFirst({ where: eq(folders.id, "child-b") });

    expect(childA?.parentId).toBe("group");
    expect(childA?.slug).toBe("group/child-a");
    expect(childB?.parentId).toBe("group");
    expect(childB?.slug).toBe("group/child-b");
  });

  test("returns an error when a selected child cannot be moved", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values({ id: "child-a", name: "Child A", slug: "child-a" });

    const result = await createFolderAndMoveChildren("Group", null, ["child-a", "missing"], {
      createId: () => "group",
      uploadsDir: "/uploads-test",
      exists: () => false,
      rename: async () => {},
      ensureDir: async () => {},
      generatePreview: async () => null,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected grouping to fail");
    expect(result.error.message).toBe("Folder not found");
  });
});
