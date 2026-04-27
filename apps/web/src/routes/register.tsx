import { Form, redirect, useActionData, useSearchParams, useLoaderData } from "react-router";
import type { Route } from "./+types/register";
import {
  createUser,
  getSessionCookie,
  login,
  parseSessionCookie,
  getUserFromSession,
  getInviteByCode,
} from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
  if (user) {
    return redirect("/folders");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // Validate invite code if provided
  if (code) {
    const invite = await getInviteByCode(code);
    if (!invite || !invite.isActive) {
      return redirect("/login?error=invalid_invite");
    }
    if (invite.maxUses !== null && (invite.useCount ?? 0) >= invite.maxUses) {
      return redirect("/login?error=invite_exhausted");
    }
  }

  return { code };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;
  const inviteCode = formData.get("inviteCode") as string;

  if (!inviteCode) {
    return { error: "Invite code is required" };
  }

  const result = await createUser(email, username, password, inviteCode);

  if (result.isErr()) {
    return { error: result.error.message };
  }

  // Auto-login after registration
  const loginResult = await login(email, password);

  if (loginResult.isErr()) {
    return redirect("/login");
  }

  return redirect("/folders", {
    headers: {
      "Set-Cookie": getSessionCookie(loginResult.value.id),
    },
  });
}

export function meta() {
  return [{ title: "Register - artbin" }];
}

export default function Register() {
  const { code } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main className="max-w-[360px] mx-auto mt-16 p-8 bg-bg border border-border">
      <h1 className="text-xl text-center mb-6">Register</h1>

      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

      <Form method="post">
        <input type="hidden" name="inviteCode" value={code || ""} />

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
            htmlFor="username"
            className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1"
          >
            Username
          </label>
          <input
            type="text"
            id="username"
            name="username"
            required
            pattern="[a-zA-Z0-9_]+"
            className="input w-full"
          />
          <div className="text-xs text-text-muted mt-1">Letters, numbers, and underscores only</div>
        </div>

        <div className="mb-4">
          <label
            htmlFor="password"
            className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1"
          >
            Password
          </label>
          <input
            type="password"
            id="password"
            name="password"
            required
            minLength={8}
            className="input w-full"
          />
          <div className="text-xs text-text-muted mt-1">At least 8 characters</div>
        </div>

        <button type="submit" className="btn btn-primary w-full">
          Create Account
        </button>
      </Form>

      <p className="mt-4 text-sm text-center">
        Already have an account? <a href="/login">Login</a>
      </p>
    </main>
  );
}
