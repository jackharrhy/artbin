import { createController } from "remix/router";

import {
  getClearSessionCookie,
  isDevelopmentAuthEnabled,
  logout,
  parseSessionCookie,
} from "#lib/auth.server";

import { requireUser } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";
import { Page } from "../../ui/page.tsx";

export default createController(routes.settings, {
  middleware: [requireUser()],
  actions: {
    index(context) {
      const user = context.user;
      if (!user) return new Response("Unauthorized", { status: 401 });
      const developmentAuth = isDevelopmentAuthEnabled();

      return context.render(
        <Page title="Settings - artbin" user={user}>
          <main className="max-w-[600px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
            <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">Settings</h1>
            <section className="mb-8">
              <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
                Account
              </h2>
              <div className="card">
                <div className="mb-4">
                  <span className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                    Username
                  </span>
                  <div>@{user.username}</div>
                </div>
                {developmentAuth ? (
                  <p className="mt-4 text-sm text-text-muted">
                    Local development mode is active. Authentication is disabled.
                  </p>
                ) : (
                  <form method="post" action={routes.settings.action.href()} className="mt-4">
                    <input type="hidden" name="intent" value="logout" />
                    <button type="submit" className="btn btn-danger btn-sm">
                      Logout
                    </button>
                  </form>
                )}
              </div>
            </section>
            {user.isAdmin ? (
              <section className="mb-8">
                <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
                  Admin
                </h2>
                <div className="card">
                  <a href={routes.admin.jobs.index.href()} className="btn btn-primary btn-sm">
                    Admin panel
                  </a>
                </div>
              </section>
            ) : null}
          </main>
        </Page>,
      );
    },

    async action(context) {
      const formData = await context.request.formData();
      if (formData.get("intent") !== "logout") {
        return new Response("Unknown settings action", { status: 400 });
      }

      const sessionId = parseSessionCookie(context.request.headers.get("Cookie"));
      if (sessionId) await logout(sessionId);

      const headers = new Headers({
        Location: routes.home.href(),
        "Set-Cookie": getClearSessionCookie(),
      });
      return new Response(null, { status: 303, headers });
    },
  },
});
