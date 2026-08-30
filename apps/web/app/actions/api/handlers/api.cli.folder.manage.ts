import type * as Route from "./types.ts";

import { requireCliAdmin } from "#lib/cli-auth.server";

import { operationCatalog } from "../../../operations/catalog.ts";
import { operationErrorResponse } from "../../../operations/errors.ts";
import { folderManageInput } from "../../../operations/folders.ts";

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCliAdmin(request);
  try {
    const input = folderManageInput.parse(await request.json());
    return Response.json(
      await operationCatalog.folderManage.execute({ user, channel: "cli" }, input),
    );
  } catch (error) {
    return operationErrorResponse(error);
  }
}
