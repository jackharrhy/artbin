import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { routes } from "../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../test/router-harness.ts";

const protectedPath = join(process.cwd(), "tmp", "router-protected.txt");

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
  await mkdir(join(process.cwd(), "tmp"), { recursive: true });
  await writeFile(protectedPath, "must survive");
});

afterEach(async () => {
  harness.close();
  await rm(protectedPath, { force: true });
});

describe("orphan cleanup mutations", () => {
  it("rejects paths that escape the uploads directory", async () => {
    const form = new FormData();
    form.set("intent", "delete-orphans");
    form.set("paths", JSON.stringify(["../../tmp/router-protected.txt"]));

    const response = await router.fetch(
      harness.request(routes.admin.orphans.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(await response.text(), "Invalid orphan path");
    await access(protectedPath);
  });
});
