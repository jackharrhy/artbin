# Service asset API

Artbin exposes approved indexed assets to trusted backend services. 4orm authenticates machine identities; Artbin authorizes access to its resources. Never call this API from browser code or expose its bearer tokens to a browser.

The API is intentionally unversioned because Artbin, 4orm, and its current consumers are deployed and migrated together.

## Authentication

Every request requires a 4orm machine access token:

```http
Authorization: Bearer <opaque-4orm-access-token>
```

Artbin introspects the token with its server-only `artbin-server` credential. It accepts only active `service` principals. Successful introspection may be cached for at most 30 seconds or until token expiry, whichever comes first. Artbin fails closed when introspection is unavailable or invalid.

Scopes:

| Scope | Access |
| --- | --- |
| `artbin:assets:read` | Catalog, canonical metadata, and WAD inspection |
| `artbin:assets:content` | Original asset bytes |

Server configuration:

```text
ARTBIN_4ORM_INTROSPECTION_SECRET=<generated in 4orm admin>
ARTBIN_4ORM_INTROSPECTION_URL=https://4orm.harrhy.xyz/oauth/introspect
ARTBIN_4ORM_INTROSPECTION_CLIENT_ID=artbin-server
```

The URL defaults to `${FOURM_URL}/oauth/introspect` and the client ID defaults to `artbin-server`. The secret has no default and must remain server-only.

## Canonical asset

Catalog and metadata responses use this shape:

```json
{
  "id": "stable-artbin-record-id",
  "name": "halflife.wad",
  "path": "_provided/goldsrc/halflife.wad",
  "kind": "archive",
  "mimeType": "application/x-wad",
  "size": 123456,
  "sha256": "64-character-lowercase-hex-digest",
  "width": null,
  "height": null,
  "folder": {
    "id": "folder-id",
    "name": "GoldSrc",
    "slug": "_provided/goldsrc"
  },
  "tags": [{ "id": "tag-id", "name": "Classic", "slug": "classic" }]
}
```

Only approved assets with a valid SHA-256 digest are exposed. Missing, pending, rejected, unhashed, and unknown records all produce the same `404 asset_not_found` response. Administrators can queue hash backfill from Admin > Orphans.

The asset ID identifies the logical Artbin record. The digest identifies the exact revision of its bytes. Consumers should persist both.

## Search the catalog

```http
GET /api/assets?q=brick&kind=texture&folderId=<id>&tag=classic&limit=30&cursor=<opaque>
```

Requires `artbin:assets:read`.

All filters are optional:

- `q`: literal filename substring, at most 120 characters;
- `kind`: one of `texture`, `model`, `audio`, `map`, `archive`, `config`, or `other`;
- `folderId`: exact folder ID, at most 160 characters;
- `tag`: exact tag slug, at most 160 characters;
- `limit`: integer from 1 through 100, default 30;
- `cursor`: opaque continuation returned by Artbin, at most 1024 characters.

Results are ordered newest first by `(createdAt, id)`. The cursor encodes the complete ordering position. Consumers must not inspect or construct it.

```json
{
  "assets": [],
  "nextCursor": null
}
```

Catalog responses use `Cache-Control: private, no-cache`.

## Get metadata

```http
GET /api/assets/:assetId
```

Requires `artbin:assets:read` and returns `{ "asset": <canonical asset> }`.

## Get original content

```http
GET /api/assets/:assetId/content?sha256=<expected-lowercase-hex-digest>
```

Requires `artbin:assets:content`. `sha256` is mandatory and pins the request to the bytes the consumer selected.

If the approved record now has another digest, Artbin returns `409 asset_hash_changed` with the expected and current digests. A consumer must explicitly accept updated metadata; it must not silently mount the new bytes.

Content is opened lazily and streamed. There is no application-level content-size cap. The endpoint supports single byte ranges, `If-Match`, `If-None-Match`, `If-Range`, modification-date conditions, and strong ETags without hashing the file again. Successful responses include:

```text
ETag: "<sha256>"
Digest: sha-256=<base64-digest>
X-Artbin-Asset-Id: <asset-id>
X-Artbin-SHA256: <lowercase-hex-digest>
Accept-Ranges: bytes
Cache-Control: private, max-age=31536000, immutable
```

The cache policy is safe because the request URL includes the expected digest and mismatches do not return content.

## Inspect a WAD

```http
GET /api/assets/:assetId/wad
```

Requires `artbin:assets:read`. Inspection is limited to WAD files no larger than 256 MiB. Artbin currently reads the WAD into memory for validated parsing.

```json
{
  "asset": {},
  "wad": {
    "version": "WAD3",
    "lumpCount": 1,
    "textures": [{
      "index": 0,
      "name": "BRICK",
      "width": 64,
      "height": 64,
      "transparent": false
    }]
  }
}
```

This is a public response mapping, not the serialized shape of Artbin's internal parser.

## Errors and availability

Errors use `{ "error": { "code": "...", "message": "...", "details": {} } }` and `Cache-Control: no-store`.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid query, limit, kind, or digest |
| 400 | `invalid_cursor` | Malformed or oversized cursor |
| 401 | `invalid_token` | Missing, inactive, expired, non-service, or otherwise invalid token |
| 403 | `insufficient_scope` | Valid service token lacks the route's scope |
| 404 | `asset_not_found` | Asset is not available through the approved API |
| 409 | `asset_hash_changed` | Stable record exists but no longer has the expected bytes |
| 413 | `asset_too_large` | WAD exceeds the inspection bound |
| 422 | `unsupported_asset` | WAD inspection requested for another asset type |
| 422 | `invalid_wad` | File is not a valid supported WAD |
| 503 | `authentication_unavailable` | Artbin cannot validate the token with 4orm |
| 503 | `asset_unavailable` | Indexed metadata exists but original bytes cannot currently be opened |

There is currently no Artbin application-level request-rate limiter. Deployment ingress limits still apply. Clients should reuse 4orm tokens until shortly before their 600-second expiry, honor `Retry-After`, avoid parallel duplicate downloads, and back off from `503` responses.

## Credential rotation

4orm temporarily accepts the current and previous `artbin-server` secrets:

1. Generate a replacement in 4orm admin.
2. Update `ARTBIN_4ORM_INTROSPECTION_SECRET` in Artbin's SOPS-backed environment.
3. deploy/restart Artbin and verify introspection;
4. finish rotation in 4orm admin to discard the previous secret hash.

Disabling `artbin-server` stops introspection. Disabling `worldview-service` stops new token issuance and revokes its outstanding tokens. Artbin's positive cache creates a maximum 30-second revocation-observation delay.
