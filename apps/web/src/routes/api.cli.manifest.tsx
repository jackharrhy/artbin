import type { Route } from "./+types/api.cli.manifest";
import { requireCliAuth } from "~/lib/cli-auth.server";
import { db } from "~/db/connection.server";
import { files } from "~/db";
import { eq } from "drizzle-orm";

interface ManifestInput {
  parentFolder: string;
  files: { path: string; sha256: string; size: number }[];
}

export async function action({ request }: Route.ActionArgs) {
  await requireCliAuth(request);

  const body = (await request.json()) as ManifestInput;

  const newFiles: string[] = [];
  const existingFiles: string[] = [];

  for (const file of body.files) {
    const fullPath = `${body.parentFolder}/${file.path}`;

    const found = await db.query.files.findFirst({
      where: eq(files.path, fullPath),
    });

    if (found) {
      existingFiles.push(file.path);
    } else {
      newFiles.push(file.path);
    }
  }

  return Response.json({ newFiles, existingFiles });
}
