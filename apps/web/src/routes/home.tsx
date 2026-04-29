import { redirect } from "react-router";

export function loader() {
  // Middleware guarantees we're authenticated at this point,
  // so always redirect to folders
  return redirect("/folders");
}

export function meta() {
  return [{ title: "artbin" }, { name: "description", content: "Texture repository" }];
}

export default function Home() {
  return (
    <main className="max-w-[360px] mx-auto mt-16 p-8 bg-bg border border-border text-center">
      <h1 className="text-2xl mb-4">artbin</h1>
      <p className="mb-6 text-text-muted">Texture repository. Invite only.</p>
      <a href="/login" className="btn btn-primary">
        Login
      </a>
    </main>
  );
}
