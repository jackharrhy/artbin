import { type Handle, type RemixNode } from "remix/ui";

import type { User } from "#db";

import { routes } from "../routes.ts";
import { Tabs } from "./navigation.tsx";
import { Page } from "./page.tsx";
import { PageHeader } from "./primitives.tsx";
import { pageStyle } from "./styles.ts";

export type AdminTab =
  | "jobs"
  | "inbox"
  | "import"
  | "archives"
  | "scan-settings"
  | "orphans"
  | "users"
  | "mcp";

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
      { id: "mcp", href: routes.admin.mcp.href(), label: "MCP" },
    ];

    return (
      <Page title={`${title} - Admin - artbin`} user={user}>
        <main mix={pageStyle}>
          <PageHeader
            title="Admin"
            description={title}
            actions={<a href={routes.settings.index.href()}>Settings</a>}
          />
          <Tabs label="Admin sections" items={tabs} activeId={active} />
          {children}
        </main>
      </Page>
    );
  };
}
