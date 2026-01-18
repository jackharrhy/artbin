import { useLoaderData, redirect, Form, useSearchParams } from "react-router";
import type { Route } from "./+types/textures";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, collections, users, tags, textureTags } from "~/db";
import { eq, desc, or, isNull, like, and, inArray } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const tagFilter = url.searchParams.get("tag") || "";
  const seamlessOnly = url.searchParams.get("seamless") === "1";

  // Get all tags for filtering UI
  const allTags = await db.query.tags.findMany({
    orderBy: [tags.name],
  });

  // Build query
  let textureIds: string[] | null = null;

  // If filtering by tag, get matching texture IDs first
  if (tagFilter) {
    const tagRecord = await db.query.tags.findFirst({
      where: eq(tags.slug, tagFilter),
    });

    if (tagRecord) {
      const taggedTextures = await db.query.textureTags.findMany({
        where: eq(textureTags.tagId, tagRecord.id),
      });
      textureIds = taggedTextures.map((t) => t.textureId);
    } else {
      textureIds = [];
    }
  }

  // Get all textures user can see
  const conditions = [
    or(
      isNull(textures.collectionId),
      eq(collections.visibility, "public"),
      eq(collections.ownerId, user.id)
    ),
  ];

  if (search) {
    conditions.push(like(textures.originalName, `%${search}%`));
  }

  if (seamlessOnly) {
    conditions.push(eq(textures.isSeamless, true));
  }

  if (textureIds !== null) {
    if (textureIds.length === 0) {
      return { user, textures: [], allTags, search, tagFilter, seamlessOnly };
    }
    conditions.push(inArray(textures.id, textureIds));
  }

  const allTextures = await db
    .select({
      id: textures.id,
      filename: textures.filename,
      originalName: textures.originalName,
      isSeamless: textures.isSeamless,
      createdAt: textures.createdAt,
      uploaderUsername: users.username,
      source: textures.source,
      collectionName: collections.name,
    })
    .from(textures)
    .leftJoin(collections, eq(textures.collectionId, collections.id))
    .leftJoin(users, eq(textures.uploaderId, users.id))
    .where(and(...conditions))
    .orderBy(desc(textures.createdAt))
    .limit(100);

  return { user, textures: allTextures, allTags, search, tagFilter, seamlessOnly };
}

export function meta() {
  return [{ title: "Textures - artbin" }];
}

export default function Textures() {
  const { textures, allTags, search, tagFilter, seamlessOnly } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b-4 border-fuchsia p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            <a href="/dashboard">
              <span className="text-fuchsia">*</span>
              <span className="text-aqua">~</span>
              <span className="text-lime"> artbin </span>
              <span className="text-aqua">~</span>
              <span className="text-fuchsia">*</span>
            </a>
          </h1>
          <nav className="flex items-center gap-4">
            <a href="/upload" className="btn btn-primary">Upload</a>
            <a href="/dashboard" className="btn">Dashboard</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        <h2 className="text-3xl font-bold text-center text-lime mb-2">
          :: Texture Library ::
        </h2>
        <hr className="hr-rainbow my-4" />

        {/* Search and Filters */}
        <div className="box-retro mb-6">
          <Form method="get" className="space-y-4">
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-48">
                <label htmlFor="q" className="block text-aqua mb-1 text-sm">
                  Search:
                </label>
                <input
                  type="text"
                  id="q"
                  name="q"
                  defaultValue={search}
                  placeholder="Search textures..."
                  className="input-retro w-full"
                />
              </div>

              <div className="min-w-36">
                <label htmlFor="tag" className="block text-aqua mb-1 text-sm">
                  Tag:
                </label>
                <select
                  id="tag"
                  name="tag"
                  defaultValue={tagFilter}
                  className="input-retro w-full"
                >
                  <option value="">All Tags</option>
                  {allTags.map((tag) => (
                    <option key={tag.id} value={tag.slug}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="seamless"
                    value="1"
                    defaultChecked={seamlessOnly}
                    className="w-4 h-4"
                  />
                  <span className="text-lime">Seamless only</span>
                </label>
              </div>

              <div className="flex items-end">
                <button type="submit" className="btn btn-primary">
                  Search
                </button>
              </div>
            </div>
          </Form>

          {/* Active filters */}
          {(search || tagFilter || seamlessOnly) && (
            <div className="mt-4 flex gap-2 flex-wrap items-center">
              <span className="text-sm text-gray">Filters:</span>
              {search && (
                <span className="tag tag-90s">q: {search}</span>
              )}
              {tagFilter && (
                <span className="tag tag-pixel">{tagFilter}</span>
              )}
              {seamlessOnly && (
                <span className="tag tag-seamless">seamless</span>
              )}
              <a href="/textures" className="text-sm text-red hover:underline">
                Clear all
              </a>
            </div>
          )}
        </div>

        {/* Tag Quick Filters */}
        {allTags.length > 0 && (
          <div className="mb-6">
            <div className="flex gap-2 flex-wrap">
              {allTags.slice(0, 12).map((tag) => (
                <a
                  key={tag.id}
                  href={`/textures?tag=${tag.slug}`}
                  className={`tag ${tagFilter === tag.slug ? "tag-fire" : "tag-pixel"}`}
                >
                  {tag.name}
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-sm mb-4">
          {textures.length} textures found
        </p>

        {textures.length === 0 ? (
          <div className="box-retro text-center">
            <p className="text-xl mb-4">No textures found!</p>
            {(search || tagFilter || seamlessOnly) ? (
              <a href="/textures" className="btn">
                Clear filters
              </a>
            ) : (
              <a href="/upload" className="btn btn-primary">
                Upload the first one
              </a>
            )}
          </div>
        ) : (
          <div className="texture-grid">
            {textures.map((texture) => (
              <a
                key={texture.id}
                href={`/texture/${texture.id}`}
                className="texture-card"
              >
                <img
                  src={`/uploads/${texture.filename}`}
                  alt={texture.originalName}
                  loading="lazy"
                />
                <div className="mt-2 text-xs">
                  <p className="text-lime truncate" title={texture.originalName}>
                    {texture.originalName}
                  </p>
                  <p className="text-gray">
                    {texture.uploaderUsername 
                      ? `by @${texture.uploaderUsername}`
                      : texture.source 
                        ? `from ${texture.source}`
                        : ""}
                  </p>
                  {texture.isSeamless && (
                    <span className="tag tag-seamless text-xs">seamless</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
