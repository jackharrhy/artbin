import { createController } from "remix/router";
import { createRequestLogger } from "evlog";
import { z } from "zod";

import { requireMcpAdmin, MCP_ADMIN_SCOPE } from "#lib/mcp-auth.server";

import { mcpOperations, mcpTools } from "../../operations/catalog.ts";
import { OperationError } from "../../operations/errors.ts";
import { routes } from "../../routes.ts";

const rpcRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export default createController(routes.mcp, {
  actions: {
    async endpointGet({ request }) {
      const user = await requireMcpAdmin(request);
      if (user instanceof Response) return user;
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      });
    },

    async endpoint({ request }) {
      const user = await requireMcpAdmin(request);
      if (user instanceof Response) return user;

      let parsed: z.output<typeof rpcRequest>;
      try {
        parsed = rpcRequest.parse(await request.json());
      } catch {
        return Response.json(rpcError(null, -32600, "Invalid Request"), {
          status: 400,
          headers: noStoreHeaders(),
        });
      }

      if (parsed.method === "initialize") {
        const requested =
          typeof parsed.params?.protocolVersion === "string" ? parsed.params.protocolVersion : null;
        const protocolVersion =
          requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested as never)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0];
        return rpcResponse(
          result(parsed.id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "artbin", version: "1.0.0" },
          }),
        );
      }
      if (parsed.method === "notifications/initialized") {
        return new Response(null, { status: 202, headers: noStoreHeaders() });
      }
      if (parsed.method === "tools/list") {
        return rpcResponse(result(parsed.id, { tools: mcpTools }));
      }
      if (parsed.method === "tools/call") {
        const name = String(parsed.params?.name ?? "");
        const log = createRequestLogger();
        log.set({ mcp: { tool: name, userId: user.id } });
        const operation = mcpOperations.get(name);
        if (!operation) {
          log.set({ mcp: { tool: name, userId: user.id, outcome: "unknown-tool" } });
          log.emit();
          return rpcResponse(result(parsed.id, toolError(`Unknown tool: ${name}`)));
        }
        try {
          const value = await operation.execute(
            { user, channel: "mcp" },
            parsed.params?.arguments ?? {},
          );
          log.set({ mcp: { tool: name, userId: user.id, outcome: "success" } });
          log.emit();
          return rpcResponse(
            result(parsed.id, {
              content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
              structuredContent: value,
            }),
          );
        } catch (error) {
          const expected =
            error instanceof OperationError ||
            (error && typeof error === "object" && "issues" in error);
          const message =
            error instanceof OperationError
              ? error.message
              : error && typeof error === "object" && "issues" in error
                ? "Operation input is invalid"
                : "Tool failed";
          if (expected) {
            log.set({ mcp: { tool: name, userId: user.id, outcome: "rejected" } });
          } else {
            log.error(error instanceof Error ? error : new Error(message), {
              tool: name,
              userId: user.id,
            });
          }
          log.emit();
          return rpcResponse(result(parsed.id, toolError(message)));
        }
      }
      return rpcResponse(rpcError(parsed.id, -32601, "Method not found"));
    },

    protectedResource() {
      const resource = `${process.env.ARTBIN_URL ?? "http://localhost:5175"}/mcp`;
      return Response.json(
        {
          resource,
          authorization_servers: [process.env.FOURM_URL ?? "http://localhost:8000"],
          bearer_methods_supported: ["header"],
          scopes_supported: [MCP_ADMIN_SCOPE],
        },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    },
  },
});

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolError(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store", "Content-Type": "application/json" };
}

function rpcResponse(body: unknown): Response {
  return Response.json(body, { headers: noStoreHeaders() });
}
