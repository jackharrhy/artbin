import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { inspectBspDependencies } from "#lib/bsp-derivatives.server";

describe("BSP derivative analysis", () => {
  test("extracts normalized, unique WAD declarations", async () => {
    const fixture = await readFile(new URL("./fixtures/dm_barraco2.bsp", import.meta.url));
    const manifest = inspectBspDependencies(fixture);

    expect(manifest.version).toBe(1);
    expect(manifest.wads.length).toBeGreaterThan(0);
    expect(manifest.wads).toEqual([...new Set(manifest.wads)]);
    expect(manifest.wads.every((name) => name === name.toLowerCase())).toBe(true);
  });
});
