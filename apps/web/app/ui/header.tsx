import type { Handle } from "remix/ui";

import type { User } from "#db";

import { routes } from "../routes.ts";

export interface HeaderProps {
  user?: Pick<User, "username" | "isAdmin"> | null;
}

export function Header(handle: Handle<HeaderProps>) {
  return () => {
    const { user } = handle.props;

    return (
      <header className="sticky top-0 z-100 bg-bg border-b border-border-light flex items-center justify-between h-12 px-4">
        <a
          href={user ? routes.folders.href() : routes.home.href()}
          className="text-lg tracking-wide no-underline text-text"
        >
          artbin
        </a>
        <nav className="flex items-center gap-4" aria-label="Main navigation">
          {user ? (
            <>
              <a
                href={routes.folders.href()}
                className="text-sm no-underline text-text-muted hover:text-text"
              >
                folders
              </a>
              <a
                href={routes.myUploads.href()}
                className="text-sm no-underline text-text-muted hover:text-text"
              >
                my uploads
              </a>
              <a
                href={routes.settings.index.href()}
                className="text-sm no-underline text-text-muted hover:text-text"
              >
                @{user.username}
              </a>
              {user.isAdmin ? (
                <>
                  <a
                    href={routes.admin.inbox.index.href()}
                    className="text-sm no-underline text-text-muted hover:text-text"
                  >
                    inbox
                  </a>
                  <span className="badge-admin">admin</span>
                </>
              ) : null}
            </>
          ) : (
            <a
              href={routes.login.href()}
              className="text-sm no-underline text-text-muted hover:text-text"
            >
              login
            </a>
          )}
        </nav>
      </header>
    );
  };
}
