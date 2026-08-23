import type { Handle, RemixNode } from "remix/ui";

import type { User } from "#db";

import { Document } from "../actions/document.tsx";
import { Header } from "./header.tsx";

export interface PageProps {
  children?: RemixNode;
  title?: string;
  user?: Pick<User, "username" | "isAdmin"> | null;
}

export function Page(handle: Handle<PageProps>) {
  return () => {
    const { children, title, user } = handle.props;
    return (
      <Document title={title}>
        <Header user={user} />
        {children}
      </Document>
    );
  };
}

export function ErrorPage(handle: Handle<{ message: string; status: number }>) {
  return () => {
    const { message, status } = handle.props;
    return (
      <Page title={`${status} - artbin`}>
        <main className="min-h-screen p-8 flex flex-col items-center justify-center">
          <div className="card max-w-xl text-center">
            <h1 className="text-4xl font-bold text-danger mb-4">{status}</h1>
            <p className="text-xl mb-4">{message}</p>
            <a href="/" className="btn btn-primary">
              Return home
            </a>
          </div>
        </main>
      </Page>
    );
  };
}
