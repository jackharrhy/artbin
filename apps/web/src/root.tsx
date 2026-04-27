import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  {
    rel: "icon",
    href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎨</text></svg>",
    type: "image/svg+xml",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>artbin - texture & asset repository</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404 - Page Not Found!" : "Error!";
    details =
      error.status === 404
        ? "The requested page could not be found. Maybe it got lost in cyberspace?"
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="min-h-screen p-8 flex flex-col items-center justify-center">
      <div className="box-retro max-w-xl text-center">
        <h1 className="text-4xl font-bold text-red mb-4">{message}</h1>
        <hr className="hr-rainbow my-4" />
        <p className="text-xl mb-4">{details}</p>
        <a href="/" className="btn btn-primary">
          Return Home
        </a>
        {stack && (
          <pre className="mt-8 p-4 bg-black text-lime text-left text-sm overflow-x-auto border-gaudy-lime">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
