#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scriptDirectory, "../../../..");
const webDirectory = join(repository, "apps/web");
const requireFromWeb = createRequire(join(webDirectory, "package.json"));
const { chromium } = requireFromWeb("playwright");
const Database = requireFromWeb("better-sqlite3");

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
  const orphanBody = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1S8AAAAAElFTkSuQmCC",
    "base64",
  );

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
    await page.getByText(uploadName, { exact: true }).waitFor();
    await page.getByText(mapName, { exact: true }).waitFor();
    await shot(page, "03-file-uploaded.png");
    await page.getByRole("button", { name: "Close", exact: true }).click();
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
