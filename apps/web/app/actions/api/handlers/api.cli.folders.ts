import type * as Route from "./types.ts";

import { requireCliAuth } from "#lib/cli-auth.server";

import { operationCatalog } from "../../../operations/catalog.ts";
import { operationErrorResponse } from "../../../operations/errors.ts";
import { folderCreateInput, folderListInput } from "../../../operations/folders.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCliAuth(request);
  const url = new URL(request.url);
  try {
    const input = folderListInput.parse({
      slug: url.searchParams.get("slug") ?? undefined,
      includeSystem: url.searchParams.get("includeSystem") === "true",
    });
    return Response.json(
      await operationCatalog.foldersList.execute({ user, channel: "cli" }, input),
    );
  } catch (error) {
    return operationErrorResponse(error);
  }
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCliAuth(request);
  try {
    const input = folderCreateInput.parse(await request.json());
    return Response.json(
      await operationCatalog.foldersCreate.execute({ user, channel: "cli" }, input),
    );
  } catch (error) {
    return operationErrorResponse(error);
  }
}
