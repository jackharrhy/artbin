import { Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/register";
import { createUser, login, getSessionCookie, parseSessionCookie, getSession } from "~/lib/auth.server";

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
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;
  const inviteCode = formData.get("inviteCode") as string;

  if (!email || !username || !password || !inviteCode) {
    return { error: "All fields are required" };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }

  if (username.length < 3) {
    return { error: "Username must be at least 3 characters" };
  }

  const { user, error } = await createUser(email, username, password, inviteCode);

  if (error) {
    return { error };
  }

  // Auto-login after registration
  const { session } = await login(email, password);

  return redirect("/dashboard", {
    headers: {
      "Set-Cookie": getSessionCookie(session!.id),
    },
  });
}

export function meta() {
  return [{ title: "Register - artbin" }];
}

export default function Register() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="box-retro w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-2">
          <span className="text-aqua">~</span> Register <span className="text-aqua">~</span>
        </h1>
        <hr className="hr-rainbow my-4" />

        <p className="text-center text-sm mb-4">
          artbin is invite-only. Enter your invite code to join!
        </p>

        {actionData?.error && (
          <div className="box-warning mb-4 text-center">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div>
            <label htmlFor="inviteCode" className="block text-yellow mb-1">
              Invite Code:
            </label>
            <input
              type="text"
              id="inviteCode"
              name="inviteCode"
              required
              placeholder="XXXXXXXX"
              className="input-retro w-full uppercase"
            />
          </div>

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
            <label htmlFor="username" className="block text-lime mb-1">
              Username:
            </label>
            <input
              type="text"
              id="username"
              name="username"
              required
              minLength={3}
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
              minLength={6}
              className="input-retro w-full"
            />
          </div>

          <button type="submit" className="btn btn-success w-full">
            Join artbin
          </button>
        </Form>

        <hr className="hr-dashed my-4" />

        <p className="text-center text-sm">
          Already have an account?{" "}
          <a href="/login">Login</a>
        </p>

        <p className="text-center text-sm mt-2">
          <a href="/">Back to home</a>
        </p>
      </div>
    </div>
  );
}
