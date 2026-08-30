# Administrator MCP deployment

Artbin and 4orm deploy as one OAuth contract. The canonical protected resource is exactly:

```text
https://artbin.jackharrhy.dev/mcp
```

Do not add a trailing slash or infer the resource from the OAuth client ID or scope.

## Release order

1. Deploy 4orm with RFC 8707 resource-indicator support. Its authorization and token endpoints
   must require the canonical Artbin resource for registered MCP public clients, persist it on
   authorization codes and tokens, and return it as `aud` from introspection.
2. Verify 4orm discovery, authorization-code plus S256 PKCE, token exchange, and introspection in
   production. Confirm a token for another resource cannot introspect with the Artbin audience.
3. Confirm Artbin production configuration has matching `ARTBIN_URL`, `FOURM_URL`,
   and the existing 4orm introspection credentials.
4. Deploy Artbin. It will reject tokens without the exact introspected audience, even when their
   client ID, subject, and `artbin:admin` scope otherwise match.
5. Run an authenticated MCP initialization, `tools/list`, a read-only folder listing, a planned
   folder mutation, and one deliberately unconfirmed mutation. The unconfirmed mutation must not
   change state.

Deploying Artbin before 4orm does not weaken authorization, but the MCP endpoint will reject all
current tokens because they have no audience. Prefer the order above so the first production MCP
connection can complete normally.

## Rollback

Rolling Artbin back removes the MCP audience enforcement along with this unpublished MCP surface.
Rolling 4orm back while hardened Artbin remains deployed makes MCP authentication fail closed.
Neither rollback affects browser login or the existing machine asset API, whose service-token
contract is separate.
