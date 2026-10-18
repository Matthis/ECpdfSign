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
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/2-insert-place-scale-rotate-and-remove-signatures.md`
  summary: Make the `src/main.ts` wiring testable (e.g. a `wire()` function) and test that viewport notifications reach the overlay and that keydown triggers shortcuts.
  evidence: Deleting `pageView.onViewportShown(...)` or the keydown listener in `main.ts` leaves every test green, yet no signature is drawn or Entf/Esc stop working.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/2-insert-place-scale-rotate-and-remove-signatures.md`
  summary: In story 3, verify that pdf-lib `embedPng` handles every PNG variant the structural check accepts (16-bit, indexed, greyscale+alpha, interlaced), or reject the variants it cannot embed (severity medium, unverified).
  evidence: Only 8-bit RGBA non-interlaced fixtures are run through pdf-lib. Fixtures of each variant run through `embedPng` would settle it.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/3-save-as-new-pdf.md`
  summary: Extract the `save_pdf` body check, the no-document check and the payload encoding into pure Rust functions and unit-test them (invalid body, no accepted source, cancel = empty, success = file name).
  evidence: No test runs the command. If it returned an empty body on success, the frontend would treat the save as cancelled, and all tests would stay green.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/3-save-as-new-pdf.md`
  summary: `save_pdf` accepts only `InvokeBody::Raw`; under Tauri's postMessage IPC fallback the body arrives as JSON and every save fails with `invalid-body` (severity medium, unverified).
  evidence: To settle it, check whether the fallback can trigger in the shipped app (WebView2 or WKWebView with the strict CSP). If it can, also accept a JSON number array.
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/4-warn-before-invalidating-existing-digital-signatures.md`
  summary: Test that `main.ts` wires `confirmInvalidateSignatures` to `#signatures-dialog` with `signatureWarning(count)` (e.g. via an extracted `wireDialogs` helper).
  evidence: `confirmInvalidateSignatures: () => discardDialog.ask()` type-checks and every test stays green, yet the warning would ask "Platzierte Elemente verwerfen?".
- source_spec: `_bmad-output/specs/spec-ecpdfsign/stories/6-place-date-texts.md`
  summary: Verify that pdf-lib/`@pdf-lib/fontkit` subsetting embeds correct outlines for Noto Sans composite glyphs (accents such as Ł, ó, ź, ø, ü) in the saved PDF (severity medium, unverified).
  evidence: Save tests check corners and `getTextContent` strings (ToUnicode) only. Settle by opening a saved "Łódź, Ærøskøbing, Zürich" PDF in Acrobat and Edge, or by comparing the embedded subset's glyph outlines with the source font.
  resolved_by: `_bmad-output/implementation-artifacts/spec-post-test-fixes.md`. The bug was real, and it hit every glyph after the first odd-length one, not only composite glyphs. Fontkit's subset copies glyphs unpadded but writes short `loca` offsets. Fixed by re-saving the bundled font with 4-byte glyph padding (`src/assets/fonts/README.md`). `src/pdf/save.test.ts` now compares the embedded subset's outlines with the source font.
- source_spec: `_bmad-output/implementation-artifacts/spec-post-test-fixes.md`
  summary: Closing the app window discards placed elements without asking, even when `hasUnsavedChanges(state)` is true (severity medium).
  evidence: Neither `src/main.ts` nor `src/app.ts` handles a window close (`onCloseRequested`/`beforeunload`). The discard question exists only in `openPdf()`. This was there before the spec, which now provides the unsaved-changes signal a close prompt would need.
