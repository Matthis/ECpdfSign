import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { PDFJS_ASSET_DIRS, PDFJS_ASSET_PREFIX } from "./src/pdf/pdfjsAssets.ts";

const host = process.env.TAURI_DEV_HOST;

/** Only pdf.js' JavaScript sandbox uses QuickJS; PDF scripting is never enabled, so don't ship it. */
const isShippedPdfjsAsset = (name: string): boolean => !name.startsWith("quickjs-");
const pdfjsRoot = path.dirname(
  fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
);

const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".ttf": "font/ttf",
};

/**
 * Serves (dev) and copies (build) the pdf.js data files so pdf.js never
 * fetches anything from outside the app bundle.
 */
function pdfjsLocalAssets(): Plugin {
  return {
    name: "ecpdfsign:pdfjs-local-assets",
    configureServer(server) {
      server.middlewares.use(`/${PDFJS_ASSET_PREFIX}`, (req, res, next) => {
        let urlPath: string;
        try {
          urlPath = decodeURIComponent((req.url ?? "").split("?")[0]);
        } catch {
          return next();
        }
        const parts = urlPath.split("/").filter(Boolean);
        if (
          parts.length !== 2 ||
          !(PDFJS_ASSET_DIRS as readonly string[]).includes(parts[0]) ||
          parts.some((part) => part.includes("\\") || part.includes("..")) ||
          parts[1].startsWith(".") ||
          !isShippedPdfjsAsset(parts[1])
        ) {
          return next();
        }
        const dirPath = path.join(pdfjsRoot, parts[0]);
        const file = path.resolve(dirPath, parts[1]);
        // Defence in depth: never serve anything outside the pdf.js data directory.
        if (path.dirname(file) !== dirPath) {
          return next();
        }
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader(
          "Content-Type",
          CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        );
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        for (const name of readdirSync(path.join(pdfjsRoot, dir))) {
          if (!isShippedPdfjsAsset(name)) continue;
          this.emitFile({
            type: "asset",
            fileName: `${PDFJS_ASSET_PREFIX}/${dir}/${name}`,
            source: readFileSync(path.join(pdfjsRoot, dir, name)),
          });
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [pdfjsLocalAssets()],
  build: {
    // pdf.js and pdf-lib make the main chunk ~0.9 MB; it is loaded from disk, not the network.
    chunkSizeWarningLimit: 1500,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
