// Shared by vite.config.ts (serves/copies the files) and setup.ts (points pdf.js at them).

/** URL prefix under which the pdf.js data files are served (dev) and emitted (build). */
export const PDFJS_ASSET_PREFIX = "pdfjs";

/** pdf.js data directories the worker loads at runtime: CMaps, standard fonts, wasm decoders, ICC profiles. */
export const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"] as const;

export type PdfjsAssetDir = (typeof PDFJS_ASSET_DIRS)[number];
