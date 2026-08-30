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
const originalIntrospectionSecret = process.env.ARTBIN_4ORM_INTROSPECTION_SECRET;
const originalArtbinUrl = process.env.ARTBIN_URL;

beforeEach(async () => {
  harness = await createRouterHarness();
  process.env.ARTBIN_4ORM_INTROSPECTION_SECRET = "test-secret";
  process.env.ARTBIN_URL = "http://localhost:5175";
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
        aud: "http://localhost:5175/mcp",
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
        aud: "http://localhost:5175/mcp",
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1_000) + 300,
        iat: Math.floor(Date.now() / 1_000),
      });
    }
    if (
      token === "wrong-client-token" ||
      token === "wrong-scope-token" ||
      token === "wrong-audience-token"
    ) {
      return Response.json({
        active: true,
        client_id: token === "wrong-client-token" ? "other-client" : "artbin-mcp",
        sub: "fourm-admin",
        principal_type: "user",
        scope: token === "wrong-scope-token" ? "openid profile" : "artbin:admin",
        aud:
          token === "wrong-audience-token"
            ? "https://another-resource.example/mcp"
            : "http://localhost:5175/mcp",
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
  restoreEnv("ARTBIN_4ORM_INTROSPECTION_SECRET", originalIntrospectionSecret);
  restoreEnv("ARTBIN_URL", originalArtbinUrl);
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
      capabilities: {},
      clientInfo: { name: "artbin-test", version: "1.0.0" },
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
    const tools = (
      (await mcpCall("admin-token", "tools/list").then((response) => response.json())) as any
    ).result.tools;
    assert.ok(tools.every((tool: any) => tool.outputSchema?.type === "object"));
    assert.equal(
      tools.find((tool: any) => tool.name === "artbin_job_manage").annotations.destructiveHint,
      true,
    );

    const getResponse = await router.fetch(
      harness.request(routes.mcp.endpointGet.href(), undefined, {
        headers: { Authorization: "Bearer admin-token" },
      }),
    );
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get("allow"), "POST");
  });

  it("authorizes registered clients by user, scope, audience, and local role", async () => {
    assert.equal((await mcpCall("wrong-client-token", "tools/list")).status, 200);
    assert.equal((await mcpCall("wrong-scope-token", "tools/list")).status, 403);
    assert.equal((await mcpCall("wrong-audience-token", "tools/list")).status, 401);
    assert.equal((await mcpCall("member-token", "tools/list")).status, 403);
  });

  it("rejects foreign origins, unsupported versions, and mutation notifications", async () => {
    const foreignOrigin = await router.fetch(
      harness.request(routes.mcp.endpoint.href(), undefined, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    assert.equal(foreignOrigin.status, 403);

    const unsupported = await router.fetch(
      harness.request(routes.mcp.endpoint.href(), undefined, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2099-01-01",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    assert.equal(unsupported.status, 400);

    const notification = await router.fetch(
      harness.request(routes.mcp.endpoint.href(), undefined, {
        method: "POST",
        headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "artbin_import_queue",
            arguments: { kind: "regenerate-previews", confirm: true },
          },
        }),
      }),
    );
    assert.equal(notification.status, 400);
    assert.equal(await harness.database.db.query.jobs.findFirst(), undefined);
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
      execution: { mode: "plan" },
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
      execution: { mode: "apply", confirm: true },
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
      confirm: true,
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function mcpTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await mcpCall(token, "tools/call", { name, arguments: args });
  assert.equal(response.status, 200);
  return (await response.json()) as any;
}
