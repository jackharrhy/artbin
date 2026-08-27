import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { eq } from "drizzle-orm";

import { files, folders, jobs, remoteImports, sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";

import { applyMigrations, createTestDatabase, type TestDatabase } from "../test/db.ts";
import { makeWAD3Texture } from "../test/wad-fixture.ts";
import { router } from "./router.ts";
import { routes } from "./routes.ts";

const origin = "http://artbin.test";
const uploadsRoot = join(process.cwd(), "public", "uploads", "_remix-router-test");
const inboxUploadRoot = join(process.cwd(), "public", "uploads", "_inbox", "_remix-router-test");
const inboxDestinationRoot = join(process.cwd(), "public", "uploads", "remix-router-destination");
const providedAssetsRoot = join(process.cwd(), "tmp", "bsp-assets-router-test");
const adminCookie = "artbin_session=admin-session";
const memberCookie = "artbin_session=member-session";
const originalBspAssetDirectory = process.env.ARTBIN_BSP_ASSET_DIR;

let database: TestDatabase;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  process.env.ARTBIN_REQUIRE_AUTH = "1";
  process.env.ARTBIN_BSP_ASSET_DIR = providedAssetsRoot;
  database = createTestDatabase();
  applyMigrations(database.sqlite);
  setDbForTesting(database.db);
  await database.db.insert(users).values([
    { id: "admin", username: "admin", fourmId: "fourm-admin", isAdmin: true },
    { id: "member", username: "member", fourmId: "fourm-member", isAdmin: false },
  ]);
  await database.db.insert(sessions).values([
    { id: "admin-session", userId: "admin", expiresAt: new Date(Date.now() + 60_000) },
    { id: "member-session", userId: "member", expiresAt: new Date(Date.now() + 60_000) },
  ]);
  await mkdir(uploadsRoot, { recursive: true });
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  database.close();
  await rm(uploadsRoot, { recursive: true, force: true });
  await rm(inboxUploadRoot, { recursive: true, force: true });
  await rm(inboxDestinationRoot, { recursive: true, force: true });
  await rm(providedAssetsRoot, { recursive: true, force: true });
  if (originalBspAssetDirectory === undefined) delete process.env.ARTBIN_BSP_ASSET_DIR;
  else process.env.ARTBIN_BSP_ASSET_DIR = originalBspAssetDirectory;
});

describe("native Remix router", () => {
  it("uses a document navigation to start cross-origin OAuth", async () => {
    const response = await router.fetch(request(routes.login.href()));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /href="\/auth\/4orm"[^>]*rmx-document=""/);
  });

  it("completes OAuth through the router and creates a session", async () => {
    const start = await router.fetch(request(routes.auth.fourm.href()));
    assert.equal(start.status, 302);

    const authorizeUrl = new URL(start.headers.get("location")!);
    assert.equal(authorizeUrl.pathname, "/oauth/authorize");
    assert.equal(authorizeUrl.searchParams.get("client_id"), "artbin");
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorizeUrl.searchParams.get("code_challenge"));

    const oauthCookie = start.headers.get("set-cookie")!;
    assert.match(oauthCookie, /^artbin_oauth=/);
    assert.match(oauthCookie, /HttpOnly/);
    assert.match(oauthCookie, /SameSite=Lax/);

    const tokenRequests: URLSearchParams[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        return Response.json({
          access_token: "access-token",
          token_type: "bearer",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/oauth/userinfo")) {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-token");
        return Response.json({
          sub: "fourm-member",
          username: "member",
          display_name: "Member",
          is_admin: false,
        });
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    };

    const callbackUrl = new URL(routes.auth.fourmCallback.href(), origin);
    callbackUrl.searchParams.set("code", "authorization-code");
    callbackUrl.searchParams.set("state", authorizeUrl.searchParams.get("state")!);
    const callback = await router.fetch(
      new Request(callbackUrl, { headers: { Cookie: oauthCookie.split(";", 1)[0]! } }),
    );

    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), routes.folders.href());
    const cookies = callback.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(
      cookies.some((cookie) => cookie.startsWith("artbin_oauth=") && cookie.includes("Max-Age=0")),
    );
    assert.ok(
      cookies.some((cookie) => cookie.startsWith("artbin_session=") && cookie.includes("HttpOnly")),
    );

    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0]!.get("code"), "authorization-code");
    assert.equal(tokenRequests[0]!.get("client_id"), "artbin");
    assert.ok(tokenRequests[0]!.get("code_verifier"));
    assert.equal((await database.db.select().from(sessions)).length, 3);
  });

  it("redirects protected pages to login", async () => {
    const response = await router.fetch(request(routes.folders.href()));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), routes.login.href());
  });

  it("renders the folders page with hydrated Remix controls", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values({
      id: "browse-texture",
      path: "test/browse.png",
      name: "browse.png",
      mimeType: "image/png",
      size: 12,
      kind: "texture",
      folderId: folder.id,
      status: "approved",
    });
    await database.db.insert(remoteImports).values({
      id: "browse-source",
      provider: "scmapdb",
      externalId: "test",
      destinationKey: "root",
      sourceUrl: "https://scmapdb.wikidot.com",
      title: "Test map",
      author: "Mapper",
      game: "Sven Co-op",
      metadata: "{}",
      folderId: folder.id,
    });
    const response = await router.fetch(
      request(routes.folder.index.href({ path: folder.slug }), adminCookie),
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Browse/);
    assert.match(html, /UploadControl/);
    assert.match(html, /I'm feeling lucky/);
    assert.match(html, /href="https:\/\/scmapdb\.wikidot\.com\/map:test"/);
    assert.match(html, /SCMapDB<\/a> by Mapper for Sven Co-op\./);
    assert.doesNotMatch(html, /react-router/);
  });

  it("renders the kitchen sink from the shared design system", async () => {
    const response = await router.fetch(request(routes.dev.kitchenSink.href(), adminCookie));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Kitchen sink/);
    assert.match(html, /Foundations/);
    assert.match(html, /Forms/);
    assert.match(html, /Data display/);
    assert.match(html, /Media and files/);
    assert.match(html, /UploadControl/);
    assert.match(html, /LuckyButton/);
    assert.match(html, /role="progressbar"/);
    assert.match(html, /aria-label="Example import jobs"/);
  });

  it("renders every admin surface through native controllers", async () => {
    for (const href of [
      routes.admin.jobs.index.href(),
      routes.admin.import.index.href(),
      routes.admin.inbox.index.href(),
      routes.admin.archives.index.href(),
      routes.admin.scanSettings.index.href(),
      routes.admin.orphans.index.href(),
      routes.admin.users.href(),
    ]) {
      const response = await router.fetch(request(href, adminCookie));
      assert.equal(response.status, 200, href);
      assert.match(await response.text(), /Admin/);
    }
  });

  it("rejects non-admin users from admin routes", async () => {
    const response = await router.fetch(request(routes.admin.users.href(), memberCookie));
    assert.equal(response.status, 403);
  });

  it("creates folders through the native API route", async () => {
    const response = await router.fetch(
      request(routes.api.folder.href(), adminCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Native Remix", slug: "native-remix", parentId: null }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).folder.slug, "native-remix");
    const created = await database.db.query.folders.findFirst();
    assert.ok(created);
    assert.equal(created.slug, "native-remix");
  });

  it("lists folders through the CLI API", async () => {
    await seedFolder();
    const response = await router.fetch(
      request(`${routes.api.cli.foldersGet.href()}?tree=1`, memberCookie),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { folders: Array<{ slug: string }> };
    assert.deepEqual(
      payload.folders.map((folder) => folder.slug),
      ["test"],
    );
  });

  it("renders a model page with the native Three.js client entry", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values({
      id: "model",
      path: "test/example.obj",
      name: "example.obj",
      mimeType: "model/obj",
      size: 100,
      kind: "model",
      folderId: folder.id,
      status: "approved",
    });
    const response = await router.fetch(
      request(routes.file.href({ path: "test/example.obj" }), adminCookie),
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /ModelViewer/);
    assert.match(html, /Loading model/);
  });

  it("renders BSP maps and serves nearby WAD and palette dependencies", async () => {
    const folder = await seedFolder();
    const bsp = await readFile(join(process.cwd(), "test/fixtures/dm_barraco2.bsp"));
    const wad = makeWAD3Texture("REDWALL");
    const providedWad = makeWAD3Texture("SITEWALL");
    const palette = Buffer.alloc(768, 42);
    await mkdir(join(uploadsRoot, "maps"), { recursive: true });
    await Promise.all([
      writeFile(join(uploadsRoot, "maps/example.bsp"), bsp),
      writeFile(join(uploadsRoot, "textures.wad"), wad),
      writeFile(join(uploadsRoot, "palette.lmp"), palette),
      mkdir(join(providedAssetsRoot, "goldsrc"), { recursive: true }).then(() =>
        writeFile(join(providedAssetsRoot, "goldsrc/halflife.wad"), providedWad),
      ),
    ]);
    await database.db.insert(files).values([
      {
        id: "bsp-map",
        path: "_remix-router-test/maps/example.bsp",
        name: "example.bsp",
        mimeType: "application/x-bsp",
        size: bsp.length,
        kind: "map",
        folderId: folder.id,
        status: "approved",
      },
      {
        id: "bsp-wad",
        path: "_remix-router-test/textures.wad",
        name: "textures.wad",
        mimeType: "application/x-wad",
        size: wad.length,
        kind: "archive",
        folderId: folder.id,
        status: "approved",
      },
      {
        id: "bsp-palette",
        path: "_remix-router-test/palette.lmp",
        name: "palette.lmp",
        mimeType: "application/octet-stream",
        size: palette.length,
        kind: "other",
        folderId: folder.id,
        status: "approved",
      },
    ]);

    const page = await router.fetch(
      request(routes.file.href({ path: "_remix-router-test/maps/example.bsp" }), memberCookie),
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /BspViewer/);
    assert.match(html, /Interactive BSP map/);
    assert.match(html, /\/api\/bsp\/bsp-map\/palette/);

    const wadResponse = await router.fetch(
      request(routes.api.bspWad.href({ fileId: "bsp-map", wadName: "textures.wad" }), memberCookie),
    );
    assert.equal(wadResponse.status, 200);
    assert.equal(wadResponse.headers.get("content-type"), "application/x-wad");
    assert.deepEqual(Buffer.from(await wadResponse.arrayBuffer()), wad);

    const providedWadResponse = await router.fetch(
      request(routes.api.bspWad.href({ fileId: "bsp-map", wadName: "halflife.wad" }), memberCookie),
    );
    assert.equal(providedWadResponse.status, 200);
    assert.deepEqual(Buffer.from(await providedWadResponse.arrayBuffer()), providedWad);

    const paletteResponse = await router.fetch(
      request(routes.api.bspPalette.href({ fileId: "bsp-map" }), memberCookie),
    );
    assert.equal(paletteResponse.status, 200);
    assert.deepEqual(Buffer.from(await paletteResponse.arrayBuffer()), palette);
  });

  it("serves WADs as path-based virtual folders and files", async () => {
    const folder = await seedFolder();
    const wad = makeWAD3Texture("REDWALL");
    await writeFile(join(uploadsRoot, "textures.wad"), wad);
    await database.db.insert(files).values({
      id: "wad",
      path: "_remix-router-test/textures.wad",
      name: "textures.wad",
      mimeType: "application/octet-stream",
      size: wad.length,
      kind: "archive",
      folderId: folder.id,
      status: "approved",
    });

    const library = await router.fetch(
      request(routes.folder.index.href({ path: "_remix-router-test/textures.wad" }), adminCookie),
    );
    assert.equal(library.status, 200);
    assert.match(await library.text(), /REDWALL/);

    const texture = await router.fetch(
      request(
        routes.file.href({ path: "_remix-router-test/textures.wad/REDWALL.png" }),
        adminCookie,
      ),
    );
    assert.equal(texture.status, 200);
    assert.match(texture.headers.get("content-type") ?? "", /text\/html/);
  });

  it("redirects legacy WAD URLs to the path-based library", async () => {
    const folder = await seedFolder();
    const wad = makeWAD3Texture();
    await writeFile(join(uploadsRoot, "legacy.wad"), wad);
    await database.db.insert(files).values({
      id: "legacy-wad",
      path: "_remix-router-test/legacy.wad",
      name: "legacy.wad",
      mimeType: "application/octet-stream",
      size: wad.length,
      kind: "archive",
      folderId: folder.id,
      status: "approved",
    });
    const response = await router.fetch(
      request(routes.legacyWad.href({ fileId: "legacy-wad" }), adminCookie),
    );
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      routes.folder.index.href({ path: "_remix-router-test/legacy.wad" }),
    );
  });

  it("returns a random asset from the native lucky endpoint", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values({
      id: "texture",
      path: "test/lucky.png",
      name: "lucky.png",
      mimeType: "image/png",
      size: 12,
      kind: "texture",
      folderId: folder.id,
      status: "approved",
    });
    const form = new FormData();
    form.set("folderId", folder.id);
    const response = await router.fetch(
      request(routes.api.lucky.href(), memberCookie, { method: "POST", body: form }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { href: "/file/test/lucky.png" });
  });

  it("queues supported site imports through the admin controller", async () => {
    const target = await seedFolder();
    const form = new FormData();
    form.set("intent", "remote-site-import");
    form.set("targetFolderId", target.id);
    form.set(
      "sourceUrls",
      [
        "https://gamebanana.com/mods/140244",
        "https://www.gamebanana.com/mods/140244?duplicate=1",
        "https://scmapdb.com/map:decay",
        "https://downloads.example.com/mapper-pack.zip",
      ].join("\n"),
    );
    const response = await router.fetch(
      request(routes.admin.import.action.href(), adminCookie, { method: "POST", body: form }),
    );
    assert.equal(response.status, 303);
    const queued = await database.db.select().from(jobs);
    assert.equal(queued.length, 3);
    assert.deepEqual(
      queued.map((job) => (JSON.parse(job.input) as { targetFolderId: string }).targetFolderId),
      [target.id, target.id, target.id],
    );
  });

  it("rejects unsupported site imports before creating jobs", async () => {
    const form = new FormData();
    form.set("intent", "remote-site-import");
    form.set("sourceUrls", "https://example.com/maps/nope");
    const response = await router.fetch(
      request(routes.admin.import.action.href(), adminCookie, { method: "POST", body: form }),
    );
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Supported sources/);
    assert.equal((await database.db.select().from(jobs)).length, 0);
  });

  it("reviews pending uploads through the native inbox action", async () => {
    await database.db.insert(users).values({
      id: "uploader",
      username: "uploader",
      fourmId: "fourm-uploader",
    });
    await database.db.insert(folders).values([
      { id: "inbox", name: "Inbox", slug: "_inbox" },
      {
        id: "upload-session",
        name: "Upload",
        slug: "_inbox/_remix-router-test",
        parentId: "inbox",
        ownerId: "uploader",
      },
    ]);
    await database.db.insert(files).values({
      id: "pending-upload",
      path: "_inbox/_remix-router-test/pending.png",
      name: "pending.png",
      mimeType: "image/png",
      size: 12,
      kind: "texture",
      folderId: "upload-session",
      uploaderId: "uploader",
      status: "pending",
    });
    const form = new FormData();
    form.set("intent", "reject");
    form.set("sessionFolderId", "upload-session");
    const response = await router.fetch(
      request(routes.admin.inbox.action.href(), adminCookie, { method: "POST", body: form }),
    );
    assert.equal(response.status, 303);
    const record = await database.db.query.files.findFirst({
      where: eq(files.id, "pending-upload"),
    });
    assert.equal(record?.status, "rejected");
    assert.equal(record?.folderId, "inbox");
  });

  it("removes duplicate records while preserving the selected copy", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values([
      {
        id: "keep",
        path: "test/keep.png",
        name: "keep.png",
        mimeType: "image/png",
        size: 12,
        kind: "texture",
        folderId: folder.id,
        sha256: "same-hash",
      },
      {
        id: "remove",
        path: "test/remove.png",
        name: "remove.png",
        mimeType: "image/png",
        size: 12,
        kind: "texture",
        folderId: folder.id,
        sha256: "same-hash",
      },
    ]);
    const form = new FormData();
    form.set("intent", "delete-duplicates");
    form.set("keepId", "keep");
    form.set("deleteIds", JSON.stringify(["keep", "remove"]));
    const response = await router.fetch(
      request(routes.admin.orphans.action.href(), adminCookie, { method: "POST", body: form }),
    );
    assert.equal(response.status, 303);
    assert.ok(await database.db.query.files.findFirst({ where: eq(files.id, "keep") }));
    assert.equal(
      await database.db.query.files.findFirst({ where: eq(files.id, "remove") }),
      undefined,
    );
  });
});

function request(path: string, cookie?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return new Request(new URL(path, origin), { ...init, headers });
}

async function seedFolder() {
  const [folder] = await database.db
    .insert(folders)
    .values({ id: "folder", name: "Test", slug: "test", parentId: null })
    .returning();
  assert.ok(folder);
  return folder;
}
