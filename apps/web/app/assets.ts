import * as path from "node:path";

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
    "app/*path": "apps/web/app/*path",
    "node_modules/*path": "node_modules/*path",
  },
  allowFiles: ["apps/web/app/routes.ts", "apps/web/app/**/public/**"],
  allowPackages: ["remix", "three"],
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
  scripts: { loaders: isHmr ? [uiHmr()] : undefined },
});

const entry = "apps/web/app/actions/public/entry.ts";
const stylesheet = "apps/web/app/actions/public/app.css";

export const entryHref = await assetServer.getHref(entry);
export const entryPreloads = await assetServer.getPreloads(entry);
export const stylesheetHref = await assetServer.getHref(stylesheet);
