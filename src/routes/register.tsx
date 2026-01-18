import { Form, redirect, useActionData, useSearchParams, useLoaderData } from "react-router";
import type { Route } from "./+types/register";
import { createUser, getSessionCookie, login, parseSessionCookie, getUserFromSession, getInviteByCode } from "~/lib/auth.server";
import { Header } from "~/components/Header";

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

  if (result.error) {
    return { error: result.error };
  }

  // Auto-login after registration
  const loginResult = await login(email, password);

  if (loginResult.error) {
    return redirect("/login");
  }

  return redirect("/folders", {
    headers: {
      "Set-Cookie": getSessionCookie(loginResult.session!.id),
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
    <div>
      <Header />
      <main className="auth-container">
        <h1 className="auth-title">Register</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        <Form method="post">
          <input type="hidden" name="inviteCode" value={code || ""} />
          
          <div className="form-group">
            <label htmlFor="email" className="form-label">Email</label>
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
            <label htmlFor="username" className="form-label">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              required
              pattern="[a-zA-Z0-9_]+"
              className="input"
              style={{ width: "100%" }}
            />
            <div className="form-help">Letters, numbers, and underscores only</div>
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              required
              minLength={8}
              className="input"
              style={{ width: "100%" }}
            />
            <div className="form-help">At least 8 characters</div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Create Account
          </button>
        </Form>

        <p style={{ marginTop: "1rem", fontSize: "0.875rem", textAlign: "center" }}>
          Already have an account? <a href="/login">Login</a>
        </p>
      </main>
    </div>
  );
}
