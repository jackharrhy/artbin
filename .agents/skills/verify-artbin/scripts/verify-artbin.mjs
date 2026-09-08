#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scriptDirectory, "../../../..");
const webDirectory = join(repository, "apps/web");
const requireFromWeb = createRequire(join(webDirectory, "package.json"));
const { chromium } = requireFromWeb("playwright");
const Database = requireFromWeb("better-sqlite3");
const sharp = requireFromWeb("sharp");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv.includes("--help")) {
  console.log("Usage: verify-artbin.mjs [--evidence <directory>]");
  process.exit(0);
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evidenceDirectory = resolve(
  argument("--evidence") ?? join(repository, "artifacts/verification/artbin", timestamp),
);
const runtimeDirectory = await mkdtemp(join(tmpdir(), "artbin-verification-"));
const publicDirectory = join(runtimeDirectory, "public");
const uploadsDirectory = join(publicDirectory, "uploads");
const tempDirectory = join(runtimeDirectory, "tmp/uploads");
const databasePath = join(runtimeDirectory, "artbin.db");
await mkdir(uploadsDirectory, { recursive: true });
await mkdir(evidenceDirectory, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  repository,
  evidenceDirectory,
  runtimeDirectory,
  baseUrl: null,
  serverPid: null,
  flows: [],
  state: {},
};
const consoleEvents = [];
const serverOutput = [];
let browser;
let serverProcess;

async function persist() {
  await writeFile(join(evidenceDirectory, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(evidenceDirectory, "console.json"), JSON.stringify(consoleEvents, null, 2));
  await writeFile(join(evidenceDirectory, "server.log"), serverOutput.join(""));
}

async function unusedPort() {
  return await new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port"));
      listener.close(() => resolvePort(address.port));
    });
  });
}

async function waitForReady(url) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Artbin exited before readiness (${serverProcess?.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/folders`);
      if (response.ok) return;
      lastError = new Error(`Readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Artbin did not become ready: ${lastError}`);
}

async function stopOwnedProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 3_000)),
  ]);
  if (!graceful && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await exited;
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function flow(name, operation) {
  const entry = { name, status: "running", startedAt: new Date().toISOString() };
  report.flows.push(entry);
  try {
    entry.assertions = await operation();
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed";
    entry.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    entry.finishedAt = new Date().toISOString();
    await persist();
  }
}

async function shot(page, name) {
  const path = join(evidenceDirectory, name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

try {
  await persist();
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  report.baseUrl = baseUrl;
  serverProcess = spawn(process.execPath, ["--import", "remix/node-tsx", "server.ts"], {
    cwd: webDirectory,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
      ARTBIN_REQUIRE_AUTH: "",
      ARTBIN_DB_PATH: databasePath,
      ARTBIN_PUBLIC_DIR: publicDirectory,
      ARTBIN_TEMP_DIR: tempDirectory,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  report.serverPid = serverProcess.pid;
  for (const stream of [serverProcess.stdout, serverProcess.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => serverOutput.push(chunk));
  }
  await waitForReady(baseUrl);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleEvents.push({ type: `console:${message.type()}`, text: message.text(), url: page.url() });
    }
  });
  page.on("pageerror", (error) => {
    consoleEvents.push({ type: "pageerror", text: error.stack ?? error.message, url: page.url() });
  });

  const nonce = Date.now().toString(36);
  const folderName = `Verification ${nonce}`;
  const folderSlug = `verification-${nonce}`;
  const uploadName = `proof-${nonce}.txt`;
  const uploadBody = `Artbin verification ${nonce}\n`;
  const mapName = `map-${nonce}.bsp`;
  const mapBody = await readFile(join(webDirectory, "test/fixtures/dm_barraco2.bsp"));
  const orphanFolder = `orphan-${nonce}`;
  const orphanName = `{loose-${nonce}.png`;
  const orphanPath = `${orphanFolder}/${orphanName}`;
  const orphanBody = await sharp({ create: { width: 1, height: 1, channels: 4, background: "green" } }).png().toBuffer();

  await flow("library and admin readiness", async () => {
    await page.goto(`${baseUrl}/folders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add", exact: true }).waitFor();
    await shot(page, "01-library.png");
    return ["library loaded", "development administrator can add content"];
  });

  await flow("administrator MCP surface", async () => {
    await page.goto(`${baseUrl}/admin/mcp`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Administrator MCP server", exact: true }).waitFor();
    await page.getByText("artbin_folder_manage", { exact: false }).waitFor();
    await page.getByText("artbin_preview_regenerate", { exact: false }).waitFor();
    check((await page.getByText("artbin:admin", { exact: true }).count()) === 1, "MCP scope was not shown once");
    const unauthorized = await page.request.post(`${baseUrl}/mcp`, {
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    check(unauthorized.status() === 401, `Unauthenticated MCP request returned ${unauthorized.status()}`);
    await shot(page, "09-admin-mcp.png");
    return ["MCP details are admin-only", "tool catalog rendered", "unauthenticated MCP calls fail closed"];
  });

  await flow("create folder", async () => {
    await page.goto(`${baseUrl}/folders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Create folder", exact: true }).click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create folder", exact: true }) });
    await form.locator('input[name="name"]').fill(folderName);
    await form.getByRole("button", { name: "Create folder", exact: true }).click();
    await page.getByText(folderName, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await shot(page, "02-folder-created.png");
    return [`folder ${folderSlug} is visible after UI mutation`];
  });

  await flow("upload and search", async () => {
    await page.getByText(folderName, { exact: true }).click();
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.locator('input[type="file"]').first().setInputFiles([
      {
        name: uploadName,
        mimeType: "text/plain",
        buffer: Buffer.from(uploadBody),
      },
      {
        name: mapName,
        mimeType: "application/x-bsp",
        buffer: mapBody,
      },
    ]);
    await page.getByRole("button", { name: "Upload 2 files", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).waitFor({ state: "hidden" });
    await page.getByText(uploadName, { exact: true }).waitFor();
    await page.getByText(mapName, { exact: true }).waitFor();
    await shot(page, "03-file-uploaded.png");
    const folderUrl = new URL(page.url());
    folderUrl.searchParams.set("view", "all");
    await page.goto(folderUrl.href, { waitUntil: "networkidle" });
    const search = page.getByRole("searchbox");
    await search.fill(uploadName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByText(uploadName, { exact: true }).waitFor();
    check(new URL(page.url()).searchParams.get("q") === uploadName, "Search query was not reflected in the URL");
    await shot(page, "04-search-result.png");
    const mapsUrl = new URL(page.url());
    mapsUrl.search = "?view=maps";
    await page.goto(mapsUrl.href, { waitUntil: "networkidle" });
    await page.getByText(mapName, { exact: true }).waitFor();
    check((await page.getByText(uploadName, { exact: true }).count()) === 0, "Maps included a non-map file");
    await shot(page, "05-maps-tab.png");
    return [
      "file upload completed",
      "uploaded file returned by search",
      "BSP appears exclusively in the folder Maps view",
    ];
  });

  await flow("scan and adopt orphan", async () => {
    await mkdir(join(uploadsDirectory, orphanFolder), { recursive: true });
    await writeFile(join(uploadsDirectory, orphanPath), orphanBody);
    await page.goto(`${baseUrl}/admin/orphans`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Scan uploads", exact: true }).click();
    await page.getByRole("button", { name: "Adopt orphan files", exact: true }).waitFor();
    await shot(page, "06-orphan-scanned.png");
    await page.getByRole("button", { name: "Adopt orphan files", exact: true }).click();
    await page.getByText("Adopted 1 file.", { exact: true }).waitFor();
    await shot(page, "07-orphan-adopted.png");
    await page.goto(`${baseUrl}/file/${orphanFolder}/${encodeURIComponent(orphanName)}`, {
      waitUntil: "networkidle",
    });
    const image = page.getByRole("img", { name: orphanName, exact: true });
    await image.waitFor();
    check(
      await image.evaluate((element) => element.naturalWidth === 1 && element.naturalHeight === 1),
      "Special-character image did not load through indexed media",
    );
    await shot(page, "08-special-character-media.png");
    return [
      "isolated disk-only file detected",
      "orphan adopted through admin UI",
      "special-character image loaded through indexed media",
    ];
  });

  await flow("TGA texture preview", async () => {
    const textureName = `alpha-${nonce}.tga`;
    const header = Buffer.alloc(18);
    header[2] = 2;
    header.writeUInt16LE(2, 12);
    header.writeUInt16LE(1, 14);
    header[16] = 32;
    header[17] = 0x28;
    await page.goto(`${baseUrl}/folder/${folderSlug}?view=textures`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: textureName,
      mimeType: "image/x-tga",
      buffer: Buffer.concat([header, Buffer.from([0, 0, 255, 255, 0, 255, 0, 128])]),
    });
    const uploadResponse = page.waitForResponse((response) => /\/api\/uploads\/[a-f0-9]+\/commit$/.test(response.url()) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    check((await uploadResponse).ok(), "TGA upload failed");
    await page.getByRole("button", { name: "Close", exact: true }).waitFor({ state: "hidden" });
    await page.locator(`img[alt="${textureName}"]`).waitFor({ state: "attached" });
    await page.goto(`${baseUrl}/folder/${folderSlug}?view=textures`, { waitUntil: "networkidle" });
    const texture = page.locator(`img[alt="${textureName}"]`);
    await texture.waitFor();
    check(await texture.evaluate((img) => img.complete && img.naturalWidth === 2), "TGA preview did not decode in the browser");
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database.prepare("select has_preview, width, height from files where path = ?").get(`${folderSlug}/${textureName}`);
      check(row?.has_preview === 1 && row.width === 2 && row.height === 1, "TGA preview metadata was not persisted");
    } finally { database.close(); }
    await shot(page, "10-tga-preview.png");
    return ["TGA uploaded", "PNG preview decoded by browser", "dimensions and preview state persisted"];
  });

  await flow("nested folder previews survive move and rename", async () => {
    const { ApiClient } = await import(join(repository, "apps/cli/src/lib/api.ts"));
    const api = new ApiClient({ serverUrl: baseUrl, sessionId: "isolated-development" });
    const source = `relocate-${nonce}`;
    const target = `destination-${nonce}`;
    await api.createFolders([
      { slug: source, name: source },
      { slug: `${source}/child`, name: "Child", parentSlug: source },
      { slug: target, name: target },
    ]);
    const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#55aa88" } }).png().toBuffer();
    await api.uploadFile(`${source}/child`, { path: "proof.png", buffer: png, sha256: createHash("sha256").update(png).digest("hex") });
    await api.finalize(`${source}/child`);
    const database = new Database(databasePath, { readonly: true });
    try {
      const original = database.prepare("select id, preview_path from folders where slug = ?").get(`${source}/child`);
      check(original?.preview_path, "Nested preview was not generated before relocation");
      const previewBytes = await readFile(join(uploadsDirectory, original.preview_path));
      await api.manageFolder({ operation: "move", slug: source, destinationSlug: target, execution: { mode: "apply", confirm: true } });
      const moved = `${target}/${source}`;
      await api.manageFolder({ operation: "rename", slug: moved, name: `Renamed ${nonce}`, execution: { mode: "apply", confirm: true } });
      const renamed = `${target}/renamed-${nonce}`;
      let rejected = false;
      try {
        await api.manageFolder({ operation: "move", slug: renamed, destinationSlug: `${renamed}/child`, execution: { mode: "apply", confirm: true } });
      } catch { rejected = true; }
      check(rejected, "Moving a folder into its child was not rejected");
      const current = database.prepare("select slug, preview_path from folders where id = ?").get(original.id);
      check(current?.slug === `${renamed}/child`, "Nested folder path was not rebased");
      check(current.preview_path === `${current.slug}/_folder-preview.png`, "Preview reference retained the old prefix");
      check((await readFile(join(uploadsDirectory, current.preview_path))).equals(previewBytes), "Relocation changed the existing preview bytes");
      check((await readFile(join(uploadsDirectory, current.slug, "proof.png"))).equals(png), "Original texture bytes were not preserved");
      await page.goto(`${baseUrl}/folder/${renamed}`, { waitUntil: "networkidle" });
      const preview = page.locator(`img[src*="${original.id}"]`);
      await preview.waitFor();
      check(await preview.evaluate((img) => img.complete && img.naturalWidth > 0), "Moved folder preview failed to decode");
      await shot(page, "13-relocated-folder-preview.png");
    } finally { database.close(); }
    return ["nested preview generated", "move and rename preserve preview and original bytes", "descendant move rejected", "rebased preview decodes in browser"];
  });

  await flow("CLI resumable upload through a failing proxy", async () => {
    const { ApiClient } = await import(join(repository, "apps/cli/src/lib/api.ts"));
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 65);
    let interrupted = false;
    let heads = 0;
    let largestChunk = 0;
    const proxy = createHttpServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (request.method === "HEAD") heads++;
        if (request.method === "PATCH") largestChunk = Math.max(largestChunk, body.length);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (value && !["host", "connection", "transfer-encoding", "content-length"].includes(name)) headers.set(name, Array.isArray(value) ? value.join(",") : value);
        }
        const upstream = await fetch(`${baseUrl}${request.url}`, { method: request.method, headers,
          ...(body.length ? { body } : {}), redirect: "manual" });
        if (request.method === "PATCH" && upstream.ok && !interrupted) {
          interrupted = true;
          await upstream.arrayBuffer();
          response.writeHead(502); response.end("Simulated lost upload response"); return;
        }
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
        responseHeaders.delete("transfer-encoding");
        response.writeHead(upstream.status, Object.fromEntries(responseHeaders));
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (error) { response.writeHead(500); response.end(String(error)); }
    });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const api = new ApiClient({ serverUrl: `http://127.0.0.1:${proxy.address().port}`, sessionId: "isolated-development" });
      await api.uploadFile(folderSlug, { path: "resumable.txt", buffer: bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
      await api.finalize(folderSlug);
      check(interrupted && heads > 0, "CLI did not resume after the simulated gateway failure");
      check(largestChunk <= 1024 * 1024, "CLI exceeded its chunk size");
      check((await readFile(join(uploadsDirectory, folderSlug, "resumable.txt"))).equals(bytes), "Resumed upload bytes differ");
      const database = new Database(databasePath, { readonly: true });
      try {
        check(database.prepare("select count(*) as count from files where path = ?").get(`${folderSlug}/resumable.txt`).count === 1, "Retry created duplicate files");
      } finally { database.close(); }
      await page.goto(`${baseUrl}/folder/${folderSlug}?view=all`, { waitUntil: "networkidle" });
      await page.getByText("resumable.txt", { exact: true }).waitFor();
      await shot(page, "11-cli-resumed-upload.png");
    } finally {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }
    return ["gateway failure retried using HEAD offset", "requests bounded to 1 MiB", "file indexed once with exact bytes", "folder finalization job completed"];
  });

  await flow("browser archive upload and extraction", async () => {
    const pak = Buffer.alloc(81);
    pak.write("PACK"); pak.writeUInt32LE(17, 4); pak.writeUInt32LE(64, 8);
    pak.write("proof", 12); pak.write("proof.txt", 17);
    pak.writeUInt32LE(12, 73); pak.writeUInt32LE(5, 77);
    await page.goto(`${baseUrl}/folders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.locator('input[type="file"]').first().setInputFiles({ name: `archive-${nonce}.pak`, mimeType: "application/octet-stream", buffer: pak });
    await page.getByRole("button", { name: "Extract archive", exact: true }).waitFor();
    await shot(page, "12-archive-analysis.png");
    const extraction = page.waitForResponse((response) => /\/api\/uploads\/[a-f0-9]+\/extract$/.test(response.url()));
    await page.getByRole("button", { name: "Extract archive", exact: true }).click();
    check((await extraction).status() === 202, "Archive extraction was not queued");
    const database = new Database(databasePath, { readonly: true });
    try {
      const deadline = Date.now() + 30000;
      while (!database.prepare("select id from files where path = ?").get(`archive-${nonce}/proof.txt`)) {
        check(Date.now() < deadline, "Archive extraction did not index its file");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally { database.close(); }
    check(await readFile(join(uploadsDirectory, `archive-${nonce}/proof.txt`), "utf8") === "proof", "Extracted bytes differ");
    await page.goto(`${baseUrl}/folder/archive-${nonce}?view=all`, { waitUntil: "networkidle" });
    await page.getByText("proof.txt", { exact: true }).waitFor();
    await shot(page, "13-archive-extracted.png");
    return ["archive transferred through tus", "analysis returned through durable job", "owned extraction queued", "exact archive bytes indexed and visible"];
  });

  await flow("database and filesystem state", async () => {
    const database = new Database(databasePath, { readonly: true });
    const rows = database
      .prepare("select path, source from files where path in (?, ?, ?) order by path")
      .all(`${folderSlug}/${uploadName}`, `${folderSlug}/${mapName}`, orphanPath);
    database.close();
    check(rows.length === 3, `Expected three indexed files, found ${rows.length}`);
    check(rows.some((row) => row.path === orphanPath && row.source === "filesystem-adopted"), "Adopted orphan database row is missing or has the wrong source");
    const bytes = await readFile(join(uploadsDirectory, folderSlug, uploadName), "utf8");
    check(bytes === uploadBody, "Uploaded bytes differ from the selected file");
    check(
      (await readFile(join(uploadsDirectory, folderSlug, mapName))).equals(mapBody),
      "Uploaded BSP bytes differ from the selected file",
    );
    const bspManifestName = mapName.replace(/\.bsp$/i, ".artbin-bsp.json");
    const bspManifest = JSON.parse(
      await readFile(join(uploadsDirectory, folderSlug, bspManifestName), "utf8"),
    );
    check(
      bspManifest.format === "quake-bsp29" &&
        bspManifest.version === 29 &&
        Array.isArray(bspManifest.assets?.wads) &&
        bspManifest.assets.wads.length > 0,
      "Uploaded BSP dependency manifest is missing or empty",
    );
    check(
      (await readFile(join(uploadsDirectory, orphanPath))).equals(orphanBody),
      "Adopted file was unexpectedly changed",
    );
    report.state = {
      indexedFiles: rows,
      uploadPath: `${folderSlug}/${uploadName}`,
      mapPath: `${folderSlug}/${mapName}`,
      orphanPath,
    };
    return [
      "all files indexed",
      "uploaded bytes preserved",
      "BSP dependency manifest generated during ingestion",
      "adoption did not rewrite orphan bytes",
    ];
  });

  const unexpectedErrors = consoleEvents.filter((event) => event.type !== "console:warning");
  check(unexpectedErrors.length === 0, `Browser emitted ${unexpectedErrors.length} unexpected error(s)`);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.at(-1);
    if (page) await shot(page, "failure.png").catch(() => {});
  }
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await browser?.close().catch(() => {});
  await stopOwnedProcess(serverProcess).catch((error) => serverOutput.push(`Cleanup error: ${error}\n`));
  await persist();
  await rm(runtimeDirectory, { recursive: true, force: true });
  console.log(`${report.status.toUpperCase()}: ${evidenceDirectory}`);
}
