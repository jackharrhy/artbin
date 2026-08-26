import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { files, folders } from "#db";

import { routes } from "../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../test/router-harness.ts";

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
});

afterEach(() => harness.close());

describe("CLI finalization mutations", () => {
  it("recalculates descendant folder counts through the router", async () => {
    await harness.database.db.insert(folders).values([
      { id: "root-folder", name: "Root", slug: "router-finalize", fileCount: 99 },
      {
        id: "child-folder",
        name: "Child",
        slug: "router-finalize/child",
        parentId: "root-folder",
        fileCount: 99,
      },
    ]);
    await harness.database.db.insert(files).values({
      id: "finalized-file",
      path: "router-finalize/child/file.txt",
      name: "file.txt",
      mimeType: "text/plain",
      size: 4,
      kind: "other",
      folderId: "child-folder",
    });

    const response = await router.fetch(
      harness.request(routes.api.cli.finalize.href(), adminCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentFolder: "router-finalize" }),
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { finalized: 2 });
    const records = await harness.database.db.select().from(folders);
    assert.deepEqual(Object.fromEntries(records.map((folder) => [folder.id, folder.fileCount])), {
      "root-folder": 0,
      "child-folder": 1,
    });
  });
});
