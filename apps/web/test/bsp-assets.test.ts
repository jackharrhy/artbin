import { describe, expect, test } from "vitest";

import { selectBspAsset } from "../src/lib/bsp-assets.server.ts";

describe("BSP asset selection", () => {
  test("prefers the nearest matching game asset over the provided fallback", () => {
    const nearby = { path: "collection/mod/textures.wad" };
    const provided = { path: "_provided/goldsrc/textures.wad" };
    expect(selectBspAsset("collection/mod/maps/example.bsp", [provided, nearby])).toBe(nearby);
  });

  test("uses curated provided assets but ignores unrelated uploads", () => {
    const unrelated = { path: "another-upload/halflife.wad" };
    const provided = { path: "_provided/goldsrc/halflife.wad" };
    expect(selectBspAsset("collection/mod/maps/example.bsp", [unrelated, provided])).toBe(provided);
    expect(selectBspAsset("collection/mod/maps/example.bsp", [unrelated])).toBeNull();
  });

  test("prefers the curated asset matching a recognizable game directory", () => {
    const goldsrc = { path: "_provided/goldsrc/decals.wad" };
    const cstrike = { path: "_provided/cstrike/decals.wad" };
    expect(selectBspAsset("collection/cstrike/maps/example.bsp", [goldsrc, cstrike])).toBe(cstrike);
  });
});
