// Browser-only pdf.js wiring: the worker and all data files come from the app
// bundle (see the pdfjs-local-assets plugin in vite.config.ts), never from a CDN.

import { GlobalWorkerOptions } from "./pdfjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { configurePdfLoading } from "./document";
import { PDFJS_ASSET_PREFIX, type PdfjsAssetDir } from "./pdfjsAssets";

function assetUrl(dir: PdfjsAssetDir): string {
  return new URL(
    `${import.meta.env.BASE_URL}${PDFJS_ASSET_PREFIX}/${dir}/`,
    window.location.href,
  ).href;
}

export function setupPdfjs(): void {
  GlobalWorkerOptions.workerSrc = workerUrl;
  configurePdfLoading({
    cMapUrl: assetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("standard_fonts"),
    wasmUrl: assetUrl("wasm"),
    iccUrl: assetUrl("iccs"),
    // Missing fonts fall back to the bundled standard fonts, not system fonts,
    // so the preview matches what other viewers will show.
    useSystemFonts: false,
  });
}
