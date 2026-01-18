import { useLoaderData, redirect, Form, useSearchParams } from "react-router";
import type { Route } from "./+types/textures";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, collections, users, tags, textureTags } from "~/db";
import { eq, desc, or, isNull, like, and, inArray } from "drizzle-orm";
import { Header } from "~/components/Header";

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
    })
    .from(textures)
    .leftJoin(collections, eq(textures.collectionId, collections.id))
    .leftJoin(users, eq(textures.uploaderId, users.id))
    .where(and(...conditions))
    .orderBy(desc(textures.createdAt))
    .limit(200);

  return { user, textures: allTextures, allTags, search, tagFilter, seamlessOnly };
}

export function meta() {
  return [{ title: "Textures - artbin" }];
}

export default function Textures() {
  const { user, textures, allTags, search, tagFilter, seamlessOnly } = useLoaderData<typeof loader>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Filters */}
        <Form method="get" className="filters">
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="Search..."
            className="filter-input"
            style={{ width: "200px" }}
          />
          <select
            name="tag"
            defaultValue={tagFilter}
            className="filter-input"
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag.id} value={tag.slug}>
                {tag.name}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              name="seamless"
              value="1"
              defaultChecked={seamlessOnly}
            />
            Seamless
          </label>
          <button type="submit" className="btn btn-sm">Filter</button>
          {(search || tagFilter || seamlessOnly) && (
            <a href="/textures" className="header-link">Clear</a>
          )}
        </Form>

        {/* Grid header */}
        <div className="grid-header">
          <span className="grid-count">{textures.length} textures</span>
        </div>

        {textures.length === 0 ? (
          <div className="empty-state">
            No textures found
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
                <div className="texture-card-info">
                  {texture.originalName}
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
