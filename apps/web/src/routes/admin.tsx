import { Outlet, NavLink, redirect } from "react-router";
import type { Route } from "./+types/admin";
import { userContext } from "~/lib/auth-context.server";

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  if (!user.isAdmin) {
    throw redirect("/");
  }
  return null;
}

const tabs = [
  { to: "/admin", label: "Jobs", end: true },
  { to: "/admin/inbox", label: "Inbox" },
  { to: "/admin/import", label: "Import" },
  { to: "/admin/archives", label: "Archives" },
  { to: "/admin/scan-settings", label: "Scan Settings" },
  { to: "/admin/orphans", label: "Orphans" },
  { to: "/admin/users", label: "Users" },
];

export default function AdminLayout() {
  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-light">
        <h1 className="text-xl font-normal">Admin</h1>
        <a href="/settings" className="text-xs text-text-muted hover:text-text">
          Settings
        </a>
      </div>

      <nav className="flex gap-0 border-b border-border-light mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `px-4 py-2 text-sm no-underline whitespace-nowrap border-b-2 -mb-px ${
                isActive
                  ? "border-text text-text font-medium"
                  : "border-transparent text-text-muted hover:text-text"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </main>
  );
}
