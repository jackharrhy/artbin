import { eq } from "drizzle-orm";

import { users, type User } from "#db";
import { db } from "#db/connection.server";

import { introspectBearerToken } from "./service-auth.server.ts";

export const MCP_ADMIN_SCOPE = "artbin:admin";

export async function requireMcpAdmin(request: Request): Promise<User | Response> {
  const principal = await introspectBearerToken(request);
  if (principal instanceof Response) return mcpAuthResponse(principal);
  if (!principal.scopes.has(MCP_ADMIN_SCOPE)) {
    return mcpError(403, "insufficient_scope", `Required scope: ${MCP_ADMIN_SCOPE}`, {
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${MCP_ADMIN_SCOPE}"`,
    });
  }

  const expectedClientId = process.env.ARTBIN_MCP_CLIENT_ID ?? "artbin-mcp";
  if (principal.clientId !== expectedClientId || principal.principalType !== "user") {
    return mcpError(403, "invalid_principal", "An Artbin administrator OAuth token is required");
  }

  const user = await db.query.users.findFirst({ where: eq(users.fourmId, principal.subject) });
  if (!user || !user.isAdmin) {
    return mcpError(403, "admin_required", "Artbin administrator access is required");
  }
  return user;
}

function mcpAuthResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("WWW-Authenticate", `Bearer resource_metadata="${mcpResourceMetadataUrl()}"`);
  return new Response(response.body, { status: response.status, headers });
}

function mcpResourceMetadataUrl(): string {
  const baseUrl = process.env.ARTBIN_URL ?? "http://localhost:5175";
  return `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
}

function mcpError(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
    },
  );
}
