import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/app-layout";
import { authMiddleware, userContext } from "~/lib/auth-context.server";
import { Header } from "~/components/Header";

export const middleware = [authMiddleware];

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  return { user };
}

export default function AppLayout() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <>
      <Header user={user} />
      <Outlet />
    </>
  );
}
