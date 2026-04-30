import { readFileSync } from "fs";
import { defineConfig } from "tsup";

const uiHtml = readFileSync("dist-ui/index.html", "utf-8");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Bundle all dependencies into the output so the published package
  // has zero runtime deps. sharp is excluded since the CLI never
  // calls BSP texture extraction (the server handles that).
  noExternal: [/.*/],
  define: {
    BROWSE_UI_HTML: JSON.stringify(uiHtml),
  },
  esbuildOptions(options) {
    options.external = ["sharp", "@img/sharp-*"];
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
