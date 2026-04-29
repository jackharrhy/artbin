import type { Route } from "./+types/api.cli.whoami";
import { requireCliAdmin } from "~/lib/cli-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCliAdmin(request);
  return Response.json({
    user: {
      id: user.id,
      name: user.username,
      isAdmin: user.isAdmin,
    },
  });
}
