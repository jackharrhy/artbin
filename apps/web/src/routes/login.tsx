import { Form, redirect, useActionData, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { login, getSessionCookie, parseSessionCookie, getUserFromSession } from "~/lib/auth.server";

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
    <main className="max-w-[360px] mx-auto mt-16 p-8 bg-bg border border-border">
      <h1 className="text-xl text-center mb-6">Login</h1>

      {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

      <Form method="post">
        <div className="mb-4">
          <label
            htmlFor="email"
            className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1"
          >
            Email
          </label>
          <input type="email" id="email" name="email" required className="input w-full" />
        </div>

        <div className="mb-4">
          <label
            htmlFor="password"
            className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1"
          >
            Password
          </label>
          <input type="password" id="password" name="password" required className="input w-full" />
        </div>

        <button type="submit" className="btn btn-primary w-full">
          Login
        </button>
      </Form>

      <p className="mt-4 text-sm text-center">Need an account? Get an invite link from a member.</p>
    </main>
  );
}
