import { Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/login";
import { login, getSessionCookie, parseSessionCookie, getSession } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const session = await getSession(sessionId);
  if (session) {
    return redirect("/dashboard");
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const { session, error } = await login(email, password);

  if (error) {
    return { error };
  }

  return redirect("/dashboard", {
    headers: {
      "Set-Cookie": getSessionCookie(session!.id),
    },
  });
}

export function meta() {
  return [{ title: "Login - artbin" }];
}

export default function Login() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="box-retro w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-2">
          <span className="text-fuchsia">*</span> Login <span className="text-fuchsia">*</span>
        </h1>
        <hr className="hr-rainbow my-4" />

        {actionData?.error && (
          <div className="box-warning mb-4 text-center">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-lime mb-1">
              Email:
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              className="input-retro w-full"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-lime mb-1">
              Password:
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              className="input-retro w-full"
            />
          </div>

          <button type="submit" className="btn btn-primary w-full">
            Enter
          </button>
        </Form>

        <hr className="hr-dashed my-4" />

        <p className="text-center text-sm">
          Need an account?{" "}
          <a href="/register">Register with invite code</a>
        </p>

        <p className="text-center text-sm mt-2">
          <a href="/">Back to home</a>
        </p>
      </div>
    </div>
  );
}
