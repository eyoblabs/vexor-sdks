import { defineConfig } from "tsup";

export default defineConfig([
  // React / Node Library (ESM + CJS)
  {
    entry: {
      index: "src/index.ts",
      vanilla: "src/vanilla.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    external: ["react", "react-dom"],
  },
  // Standalone Vanilla Browser Bundle (IIFE)
  {
    entry: {
      "vexor-player": "src/vanilla/player.ts",
    },
    format: ["iife"],
    globalName: "VexorPlayer",
    minify: true,
    sourcemap: true,
  },
]);
