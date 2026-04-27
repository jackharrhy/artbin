import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/app-layout";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { Header } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
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
