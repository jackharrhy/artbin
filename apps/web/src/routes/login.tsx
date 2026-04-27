import { redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
  if (user) {
    return redirect("/folders");
  }
  return null;
}

export function meta() {
  return [{ title: "Login - artbin" }];
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const errorParam = searchParams.get("error");

  let errorMessage: string | undefined;
  if (errorParam === "access_denied") {
    errorMessage = "Authorization was denied";
  } else if (errorParam) {
    errorMessage = "Login failed - please try again";
  }

  return (
    <main className="max-w-[360px] mx-auto mt-16 p-8 bg-bg border border-border">
      <h1 className="text-xl text-center mb-6">Login</h1>

      {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

      <a href="/auth/4orm" className="btn btn-primary w-full text-center block">
        Login with 4orm
      </a>

      <p className="mt-4 text-sm text-center text-text-muted">
        You need a 4orm account to use artbin.
      </p>
    </main>
  );
}
