import { Form, redirect, useActionData, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { login, getSessionCookie, parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { Header } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
  if (user) {
    return redirect("/folders");
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const result = await login(email, password);

  if (result.isErr()) {
    return { error: result.error.message };
  }

  return redirect("/folders", {
    headers: {
      "Set-Cookie": getSessionCookie(result.value.id),
    },
  });
}

export function meta() {
  return [{ title: "Login - artbin" }];
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const errorParam = searchParams.get("error");

  let errorMessage = actionData?.error;
  if (errorParam === "invalid_invite") {
    errorMessage = "Invalid or expired invite link";
  } else if (errorParam === "invite_exhausted") {
    errorMessage = "This invite link has reached its usage limit";
  }

  return (
    <div>
      <Header />
      <main className="auth-container">
        <h1 className="auth-title">Login</h1>

        {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

        <Form method="post">
          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              className="input"
              style={{ width: "100%" }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              className="input"
              style={{ width: "100%" }}
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Login
          </button>
        </Form>

        <p style={{ marginTop: "1rem", fontSize: "0.875rem", textAlign: "center" }}>
          Need an account? Get an invite link from a member.
        </p>
      </main>
    </div>
  );
}
