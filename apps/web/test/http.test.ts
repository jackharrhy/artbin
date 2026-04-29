/**
 * HTTP integration tests
 *
 * Spins up the built react-router-serve server and makes real HTTP requests
 * to verify static file serving, auth redirects, and protected routes.
 *
 * These tests require `pnpm run build` to have been run first. They are
 * automatically skipped if no build output is found, so `pnpm run test`
 * works without a build. CI workflows run them after the build step.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const BUILD_PATH = join(process.cwd(), "build", "server", "index.js");
const hasBuild = existsSync(BUILD_PATH);

const PORT = 4389;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;

// Test fixture directory -- created in beforeAll, cleaned up in afterAll
const FIXTURE_DIR = join(process.cwd(), "public", "uploads", "_test");

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe.skipIf(!hasBuild)("HTTP integration tests", () => {
  beforeAll(async () => {
    // Create test fixture files for static serving tests
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(join(FIXTURE_DIR, "sample.txt"), "test-asset-content\n");
    writeFileSync(join(FIXTURE_DIR, "_underscored.txt"), "_test-file-content\n");
    writeFileSync(join(FIXTURE_DIR, ".dotfile.txt"), ".test-dot-content\n");

    server = spawn("node_modules/.bin/react-router-serve", ["./build/server/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "production",
        ARTBIN_DB_PATH: ":memory:",
      },
      stdio: "pipe",
    });

    server.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString();
      // Suppress known non-fatal noise (JobRunner polling on empty DB)
      if (msg.includes("no such table")) return;
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("[server stderr]", msg);
      }
    });

    await waitForServer(BASE);
  }, 15_000);

  afterAll(() => {
    server?.kill("SIGTERM");
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  describe("static file serving", () => {
    test("serves regular files from public/uploads", async () => {
      const res = await fetch(`${BASE}/uploads/_test/sample.txt`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.trim()).toBe("test-asset-content");
    });

    test("serves underscore-prefixed files (like _folder-preview.png)", async () => {
      const res = await fetch(`${BASE}/uploads/_test/_underscored.txt`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.trim()).toBe("_test-file-content");
    });

    test("does NOT serve dotfiles (this is expected server behavior)", async () => {
      const res = await fetch(`${BASE}/uploads/_test/.dotfile.txt`);
      // sirv returns 404 for dotfiles -- this is why we use _ not . for previews
      expect(res.status).not.toBe(200);
    });
  });

  describe("auth redirects", () => {
    test("/folders redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/folders`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    test("/settings redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/settings`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    test("/admin/jobs redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/admin/jobs`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    test("/admin/users redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/admin/users`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });
  });

  describe("oauth flow", () => {
    test("/auth/4orm redirects to the 4orm authorize URL", async () => {
      const res = await fetch(`${BASE}/auth/4orm`, { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/oauth/authorize");
      expect(location).toContain("response_type=code");
      expect(location).toContain("code_challenge_method=S256");
      const cookies = res.headers.get("set-cookie") ?? "";
      expect(cookies).toContain("artbin_oauth=");
    });

    test("/auth/4orm/callback without code redirects to /login with error", async () => {
      const res = await fetch(`${BASE}/auth/4orm/callback`, { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/login");
      expect(location).toContain("error=");
    });
  });

  describe("public pages", () => {
    test("/login returns 200 and shows 4orm login button", async () => {
      const res = await fetch(`${BASE}/login`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Login with 4orm");
    });

    test("/ returns 200", async () => {
      const res = await fetch(`${BASE}/`);
      expect(res.status).toBe(200);
    });
  });

  describe("API routes", () => {
    test("/api/upload returns 401 when not authenticated", async () => {
      const res = await fetch(`${BASE}/api/upload`, {
        method: "POST",
        redirect: "manual",
      });
      expect(res.status).toBe(401);
    });

    test("/api/folder returns 401 when not authenticated", async () => {
      const res = await fetch(`${BASE}/api/folder`, {
        method: "POST",
        redirect: "manual",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("session cookies", () => {
    test("oauth cookie includes Secure flag in production", async () => {
      const res = await fetch(`${BASE}/auth/4orm`, { redirect: "manual" });
      const cookies = res.headers.get("set-cookie") ?? "";
      expect(cookies).toContain("Secure");
    });
  });
});
