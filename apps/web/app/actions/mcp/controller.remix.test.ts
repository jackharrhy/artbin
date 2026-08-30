import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { folders, jobs } from "#db";
import { clearServiceAuthCacheForTesting } from "#lib/service-auth.server";

import { routes } from "../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../test/router-harness.ts";

let harness: RouterHarness;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  harness = await createRouterHarness();
  process.env.ARTBIN_4ORM_INTROSPECTION_SECRET = "test-secret";
  process.env.ARTBIN_MCP_CLIENT_ID = "artbin-mcp";
  clearServiceAuthCacheForTesting();
  globalThis.fetch = async (_input, init) => {
    const token = new URLSearchParams(String(init?.body)).get("token");
    if (token === "admin-token") {
      return Response.json({
        active: true,
        client_id: "artbin-mcp",
        sub: "fourm-admin",
        principal_type: "user",
        scope: "artbin:admin",
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1_000) + 300,
        iat: Math.floor(Date.now() / 1_000),
      });
    }
    if (token === "member-token") {
      return Response.json({
        active: true,
        client_id: "artbin-mcp",
        sub: "fourm-member",
        principal_type: "user",
        scope: "artbin:admin",
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1_000) + 300,
        iat: Math.floor(Date.now() / 1_000),
      });
    }
    if (token === "wrong-client-token" || token === "wrong-scope-token") {
      return Response.json({
        active: true,
        client_id: token === "wrong-client-token" ? "other-client" : "artbin-mcp",
        sub: "fourm-admin",
        principal_type: "user",
        scope: token === "wrong-scope-token" ? "openid profile" : "artbin:admin",
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1_000) + 300,
        iat: Math.floor(Date.now() / 1_000),
      });
    }
    return Response.json({ active: false });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearServiceAuthCacheForTesting();
  harness.close();
});

describe("administrator MCP", () => {
  it("publishes protected-resource metadata without exposing tools publicly", async () => {
    const metadata = await router.fetch(harness.request(routes.mcp.protectedResource.href()));
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), {
      resource: "http://localhost:5175/mcp",
      authorization_servers: ["http://localhost:8000"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["artbin:admin"],
    });

    const unauthorized = await mcpCall("invalid-token", "tools/list");
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  });

  it("initializes and lists the bounded operation catalog", async () => {
    const initialized = await mcpCall("admin-token", "initialize", {
      protocolVersion: "2025-11-25",
    });
    assert.equal(initialized.status, 200);
    const initializeBody = (await initialized.json()) as any;
    assert.equal(initializeBody.result.serverInfo.name, "artbin");

    const listed = await mcpCall("admin-token", "tools/list");
    const names = ((await listed.json()) as any).result.tools.map((tool: any) => tool.name);
    assert.deepEqual(names, [
      "artbin_folders_list",
      "artbin_folders_create",
      "artbin_folder_manage",
      "artbin_jobs_list",
      "artbin_job_manage",
      "artbin_import_queue",
    ]);

    const getResponse = await router.fetch(
      harness.request(routes.mcp.endpointGet.href(), undefined, {
        headers: { Authorization: "Bearer admin-token" },
      }),
    );
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get("allow"), "POST");
  });

  it("rejects tokens with the wrong client, scope, or local role", async () => {
    assert.equal((await mcpCall("wrong-client-token", "tools/list")).status, 403);
    assert.equal((await mcpCall("wrong-scope-token", "tools/list")).status, 403);
    assert.equal((await mcpCall("member-token", "tools/list")).status, 403);
  });

  it("returns the same folder result through CLI REST and MCP", async () => {
    await harness.database.db.insert(folders).values({
      id: "maps",
      name: "Maps",
      slug: "maps",
      fileCount: 3,
    });
    const rest = await router.fetch(harness.request(routes.api.cli.foldersGet.href(), adminCookie));
    const mcp = await mcpTool("admin-token", "artbin_folders_list", {});
    assert.deepEqual(mcp.result.structuredContent, await rest.json());
  });

  it("plans then applies a folder mutation and rejects non-admin principals", async () => {
    await harness.database.db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    const plan = await mcpTool("admin-token", "artbin_folder_manage", {
      operation: "rename",
      slug: "maps",
      name: "Classic Maps",
      dryRun: true,
    });
    assert.equal(plan.result.structuredContent.plan.to.slug, "classic-maps");
    assert.ok(
      await harness.database.db.query.folders.findFirst({
        where: (table, { eq }) => eq(table.slug, "maps"),
      }),
    );

    const applied = await mcpTool("admin-token", "artbin_folder_manage", {
      operation: "rename",
      slug: "maps",
      name: "Classic Maps",
      dryRun: false,
    });
    assert.equal(applied.result.isError, undefined);
    assert.ok(
      await harness.database.db.query.folders.findFirst({
        where: (table, { eq }) => eq(table.slug, "classic-maps"),
      }),
    );

    const denied = await mcpCall("member-token", "tools/list");
    assert.equal(denied.status, 403);
  });

  it("requires explicit confirmation for destructive job operations", async () => {
    await harness.database.db.insert(jobs).values({
      id: "pending-job",
      type: "test",
      input: "{}",
      status: "pending",
    });
    const unconfirmed = await mcpTool("admin-token", "artbin_job_manage", {
      jobId: "pending-job",
      operation: "delete",
      confirm: false,
    });
    assert.equal(unconfirmed.result.isError, true);
    assert.ok(await harness.database.db.query.jobs.findFirst());

    const confirmed = await mcpTool("admin-token", "artbin_job_manage", {
      jobId: "pending-job",
      operation: "delete",
      confirm: true,
    });
    assert.equal(confirmed.result.structuredContent.deleted, true);
    assert.equal(await harness.database.db.query.jobs.findFirst(), undefined);
  });

  it("queues maintenance imports through the shared operation", async () => {
    const queued = await mcpTool("admin-token", "artbin_import_queue", {
      kind: "regenerate-previews",
    });
    assert.equal(queued.result.structuredContent.count, 1);
    const job = await harness.database.db.query.jobs.findFirst();
    assert.equal(job?.type, "regenerate-previews");
    assert.equal(job?.userId, "admin");
  });
});

async function mcpCall(token: string, method: string, params: Record<string, unknown> = {}) {
  return router.fetch(
    harness.request(routes.mcp.endpoint.href(), undefined, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
}

async function mcpTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await mcpCall(token, "tools/call", { name, arguments: args });
  assert.equal(response.status, 200);
  return (await response.json()) as any;
}
