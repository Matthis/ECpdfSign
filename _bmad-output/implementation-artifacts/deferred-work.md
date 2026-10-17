- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/1-toolbar-shell-pdf-open-and-page-preview.md`
  summary: Add an automated check that every command in `build.rs` AppManifest has a matching `allow-*` grant in the main capability.
  evidence: Removing `allow-accept-opened-pdf` from `default.json` keeps the build and all tests green, yet breaks every open at runtime. Real coverage needs a Tauri e2e or webdriver harness.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/1-toolbar-shell-pdf-open-and-page-preview.md`
  summary: Decide in story 3 whether PDFs that pdf.js opens but pdf-lib cannot parse are rejected at open or handled at save (severity medium, unverified).
  evidence: `isEncryptedForPdfLib` swallows pdf-lib parse errors and returns false. To settle it, run pdf-lib `PDFDocument.load` against a corpus of real-world PDFs that pdf.js accepts.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/1-toolbar-shell-pdf-open-and-page-preview.md`
  summary: `openPdf` awaits `previous.pdf.destroy()` inside the open lock; a hanging destroy would leave "PDF Öffnen" disabled (severity medium, unverified).
  evidence: To settle it, check whether pdf.js `PDFDocumentLoadingTask.destroy()` can stay pending while the worker is stuck. If it can, the fix is a non-awaited `void previous.pdf.destroy()`.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/1-toolbar-shell-pdf-open-and-page-preview.md`
  summary: The thumbnail strip's shared `running` counter can leak slots if an old document's in-flight `getPage` never settles after destroy (severity medium, unverified).
  evidence: To settle it, check whether pdf.js rejects or abandons pending `getPage` promises on `destroy()`. If they are abandoned, track `running` per generation.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/1-toolbar-shell-pdf-open-and-page-preview.md`
  summary: CLAUDE.md says Vitest runs in the Node environment, but `src/ui/thumbnails.test.ts` uses happy-dom per file.
  evidence: The fix edits an agent-context file, so it is out of scope for an auto-patch.
