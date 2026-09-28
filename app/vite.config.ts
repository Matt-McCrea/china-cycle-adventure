import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` → normal multi-file site in dist/
// `npm run build:single` → one self-contained HTML file in dist-single/ (for sharing / previews)
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: mode === "single" ? { outDir: "dist-single", assetsInlineLimit: 100_000_000 } : {},
}));
