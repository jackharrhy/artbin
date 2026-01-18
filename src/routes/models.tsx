import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/models";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, models } from "~/db";
import { desc } from "drizzle-orm";
import { Header } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const allModels = await db.query.models.findMany({
    orderBy: [desc(models.createdAt)],
  });

  return { user, models: allModels };
}

export function meta() {
  return [{ title: "Models - artbin" }];
}

export default function Models() {
  const { user, models } = useLoaderData<typeof loader>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Models</h1>
          <a href="/upload/model" className="btn btn-primary">Upload Model</a>
        </div>

        {models.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
            <p style={{ marginBottom: "1rem" }}>No models uploaded yet.</p>
            <a href="/upload/model" className="btn btn-primary">Upload your first model</a>
          </div>
        ) : (
          <div className="texture-grid">
            {models.map((model) => (
              <a key={model.id} href={`/model/${model.id}`} className="texture-card">
                <div className="texture-thumb" style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  backgroundColor: "#f5f5f5",
                  fontSize: "2rem"
                }}>
                  <span style={{ opacity: 0.5 }}>3D</span>
                </div>
                <div className="texture-info">
                  <span className="texture-name">{model.originalName}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
