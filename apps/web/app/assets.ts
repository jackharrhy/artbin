import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

import { createAssetServer } from "remix/assets";
import { uiHmr } from "remix/ui-hmr/assets";

const webRoot = path.resolve(import.meta.dirname, "..");
const rootDir = path.resolve(webRoot, "../..");
const isDevelopment = (process.env.NODE_ENV ?? "development") === "development";
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR);

export const assetServer = createAssetServer({
  basePath: "/assets",
  rootDir,
  fileMap: {
    "shared/uploads.ts": "packages/core/src/uploads.ts",
    "app/*path": "apps/web/app/*path",
    "node_modules/*path": "node_modules/*path",
  },
  allowFiles: [
    "apps/web/app/routes.ts",
    "apps/web/app/ui/styles.ts",
    "apps/web/app/ui/modal.tsx",
    "apps/web/app/ui/primitives.tsx",
    "apps/web/app/ui/file-collection.tsx",
    "apps/web/app/ui/media-card.tsx",
    "apps/web/app/**/public/**",
  ],
  allowPackages: ["@artbin/core", "@jackharrhy/worldview", "remix", "three"],
  denyFiles: ["apps/web/app/**/*.test.*"],
  files: {
    extensions: [".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2"],
  },
  sourceMaps: isDevelopment ? "external" : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  hmr: isHmr
    ? async () => (await import("remix/node-hmr/runtime")).createBrowserHmrChannel()
    : undefined,
  scripts: {
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
    },
    loaders: [
      // tus-js-client has CommonJS dependencies. Bundle this one shared client into
      // browser ESM through Remix's loader hook; the rest of the app stays source-served.
      (url, context, nextLoad) => {
        const result = nextLoad(url, context);
        const filename = fileURLToPath(url);
        if (filename !== path.join(rootDir, "packages/core/src/uploads.ts")) return result;
        const bundled = buildSync({
          entryPoints: [filename],
          bundle: true,
          platform: "browser",
          format: "esm",
          write: false,
          target: "es2022",
          minify: !isDevelopment,
        });
        return { ...result, format: "module", source: bundled.outputFiles[0]!.text };
      },
      ...(isHmr ? [uiHmr()] : []),
    ],
  },
});

const entry = "apps/web/app/actions/public/entry.ts";
const bspOverviewEntry = "apps/web/app/actions/public/bsp-overview-renderer.ts";

export const entryHref = await assetServer.getHref(entry);
export const entryPreloads = await assetServer.getPreloads(entry);
export const bspOverviewEntryHref = await assetServer.getHref(bspOverviewEntry);
