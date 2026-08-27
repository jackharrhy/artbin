# BSP previews and game assets

## Sub-features

BSP detection, WebGPU renderer loading, embedded textures, WAD dependency resolution, supplied GoldSrc assets, missing-texture reporting, and downloads.

## How to get to it (user POV)

Upload or adopt a supported `.bsp`, open its file detail page, and inspect the interactive map preview and dependency status.

## Driving it with Playwright

Use a legally redistributable fixture with known texture dependencies. Assert the renderer reaches its ready state, inspect browser errors, capture the canvas, and verify dependent WAD requests. Run Chromium with WebGPU support appropriate to the host when exercising rendering.

## Gotchas

Headless GPU support varies. Separate renderer/environment failures from parsing and asset-resolution failures. GoldSrc maps may reference `halflife.wad`, `cstrike.wad`, or other game-owned assets that must exist as normal indexed Artbin files; do not silently bundle unlicensed assets.
