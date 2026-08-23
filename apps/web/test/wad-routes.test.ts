import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { files, folders, type User } from "~/db/schema";
import { setDbForTesting } from "~/db/connection.server";
import { loader as fileLoader } from "~/routes/file.$";
import { loader as folderLoader } from "~/routes/folder.$slug";
import { loader as wadLoader } from "~/routes/wad.$fileId";
import { loader as legacyTextureLoader } from "~/routes/wad.$fileId.texture.$textureIndex";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";
import { makeWAD3Texture } from "./wad-fixture";

const uploadDirectory = join(process.cwd(), "public", "uploads", "_wad-route-test");
let currentDb: TestDatabase | undefined;

const user: User = {
  id: "user-1",
  username: "user",
  fourmId: "fourm-user-1",
  isAdmin: false,
  createdAt: new Date(),
};

afterEach(async () => {
  currentDb?.close();
  currentDb = undefined;
  await rm(uploadDirectory, { recursive: true, force: true });
});

async function seedWAD() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);

  const wad = makeWAD3Texture("WOODS");
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(join(uploadDirectory, "library.wad"), wad);
  await currentDb.db.insert(folders).values([
    { id: "parent", name: "Maps", slug: "maps" },
    { id: "child", name: "Example", slug: "maps/example", parentId: "parent" },
  ]);
  await currentDb.db.insert(files).values({
    id: "wad-1",
    path: "_wad-route-test/library.wad",
    name: "library.wad",
    mimeType: "application/octet-stream",
    size: wad.length,
    kind: "other",
    folderId: "child",
  });
}

function routeContext() {
  return { get: () => user };
}

describe("virtual WAD website routes", () => {
  test("loads the WAD as a folder with breadcrumb context", async () => {
    await seedWAD();

    const result = await folderLoader({
      request: new Request("http://localhost/folder/_wad-route-test/library.wad"),
      params: { slug: "_wad-route-test", "*": "library.wad" },
      context: routeContext(),
    } as any);

    if (result instanceof Response) throw new Error("Expected virtual folder data");
    if (result.page !== "wad") throw new Error("Expected WAD page data");
    expect(result.page).toBe("wad");
    expect(result.file.id).toBe("wad-1");
    expect(result.contents.textures).toMatchObject([{ name: "WOODS", index: 0 }]);
    expect(result.folderTrail.map((folder) => folder.slug)).toEqual(["maps", "maps/example"]);
  });

  test("loads an individual texture through a website detail route", async () => {
    await seedWAD();

    const result = await fileLoader({
      request: new Request("http://localhost/file/_wad-route-test/library.wad/WOODS.png"),
      params: { "*": "_wad-route-test/library.wad/WOODS.png" },
      context: routeContext(),
    } as any);

    if (result instanceof Response) throw new Error("Expected virtual texture data");
    if (result.page !== "wad-texture") throw new Error("Expected WAD texture page data");
    expect(result.page).toBe("wad-texture");
    expect(result.texture).toMatchObject({ name: "WOODS", width: 8, height: 8 });
  });

  test("redirects legacy WAD file URLs to the virtual folder", async () => {
    await seedWAD();

    const result = await fileLoader({
      request: new Request("http://localhost/file/_wad-route-test/library.wad"),
      params: { "*": "_wad-route-test/library.wad" },
      context: routeContext(),
    } as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("location")).toBe(
      "/folder/_wad-route-test/library.wad",
    );
  });

  test("redirects legacy ID-based WAD URLs to path-based URLs", async () => {
    await seedWAD();

    const libraryResult = await wadLoader({
      request: new Request("http://localhost/wad/wad-1"),
      params: { fileId: "wad-1" },
      context: routeContext(),
    } as any);
    const textureResult = await legacyTextureLoader({
      request: new Request("http://localhost/wad/wad-1/texture/0"),
      params: { fileId: "wad-1", textureIndex: "0" },
      context: routeContext(),
    } as any);

    expect((libraryResult as Response).headers.get("location")).toBe(
      "/folder/_wad-route-test/library.wad",
    );
    expect((textureResult as Response).headers.get("location")).toBe(
      "/file/_wad-route-test/library.wad/WOODS.png",
    );
  });
});
