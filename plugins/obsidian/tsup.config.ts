import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: true,
  external: ["@marswave/cola-plugin-sdk"],
});
