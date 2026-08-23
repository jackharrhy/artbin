import type { Handle, RemixNode } from "remix/ui";

import type { User } from "#db";

import { routes } from "../routes.ts";
import { Page } from "./page.tsx";

export type AdminTab =
  | "jobs"
  | "inbox"
  | "import"
  | "archives"
  | "scan-settings"
  | "orphans"
  | "users";

export function AdminPage(
  handle: Handle<{
    user: User;
    active: AdminTab;
    title: string;
    children?: RemixNode;
  }>,
) {
  return () => {
    const { user, active, title, children } = handle.props;
    const tabs: Array<{ id: AdminTab; href: string; label: string }> = [
      { id: "jobs", href: routes.admin.jobs.index.href(), label: "Jobs" },
      { id: "inbox", href: routes.admin.inbox.index.href(), label: "Inbox" },
      { id: "import", href: routes.admin.import.index.href(), label: "Import" },
      { id: "archives", href: routes.admin.archives.index.href(), label: "Archives" },
      {
        id: "scan-settings",
        href: routes.admin.scanSettings.index.href(),
        label: "Scan settings",
      },
      { id: "orphans", href: routes.admin.orphans.index.href(), label: "Orphans" },
      { id: "users", href: routes.admin.users.href(), label: "Users" },
    ];

    return (
      <Page title={`${title} - Admin - artbin`} user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-light">
            <h1 className="text-xl font-normal">Admin</h1>
            <a href={routes.settings.index.href()} className="text-xs text-text-muted">
              Settings
            </a>
          </div>
          <nav className="flex border-b border-border-light mb-6 overflow-x-auto">
            {tabs.map((tab) => (
              <a
                key={tab.id}
                href={tab.href}
                aria-current={active === tab.id ? "page" : undefined}
                className={`px-4 py-2 text-sm no-underline whitespace-nowrap border-b-2 -mb-px ${
                  active === tab.id
                    ? "border-text text-text font-medium"
                    : "border-transparent text-text-muted"
                }`}
              >
                {tab.label}
              </a>
            ))}
          </nav>
          {children}
        </main>
      </Page>
    );
  };
}
