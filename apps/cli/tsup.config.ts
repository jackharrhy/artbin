import { defineConfig } from "tsup";

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
  esbuildOptions(options) {
    options.external = ["sharp", "@img/sharp-*"];
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
