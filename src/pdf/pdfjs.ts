// The one place that picks the pdf.js build. The "legacy" build bundles
// polyfills for newer JS built-ins (e.g. Uint8Array.prototype.toHex) that
// pdfjs-dist 6 relies on; macOS WebViews before Safari 18.2 and Node.js (unit
// tests) lack them. Import pdf.js only through this module.
export * from "pdfjs-dist/legacy/build/pdf.mjs";
