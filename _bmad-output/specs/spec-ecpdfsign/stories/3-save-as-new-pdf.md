---
title: 'Save as new PDF'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '9d8efe5d51af4160237df2e8bcef996e6e617da0'
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signatures can be placed, moved, scaled and rotated, but the result cannot be saved. "Speichern" is still disabled.

**Approach:** "Speichern" builds a new PDF with pdf-lib from the untouched source bytes plus every placed signature, then hands the bytes to the backend. The backend shows a save-as dialog suggesting `<Name>_signiert.pdf` and writes the file. The original is only overwritten if the user explicitly picks its name there. Each signature appears at exactly the position, size and rotation shown in the preview, on every page type (SPEC CAP-5, CAP-2 transparency).

## Boundaries & Constraints

**Always:**
- The source file is never written implicitly. The source bytes in memory are never mutated, and pdf-lib loads a copy.
- Placement geometry is derived only through the pdf.js page viewport, the same conversion the preview uses (see Design Notes). There is no separate rotation or CropBox maths.
- Each distinct image (`imageId`) is embedded once and referenced for every placement.
- Pages, content, annotations and document metadata other than the added images stay as they were (`updateMetadata: false`).
- The backend owns the dialog and the write. The frontend sends only the PDF bytes, as a raw IPC body, not a JSON number array.
- The backend writes to a temporary file in the target folder and then renames it over the target, so a failed save never leaves a partial file or a damaged original.
- "Speichern" is disabled while no document is open or another PDF is being opened.
- Saving does not change the placed elements; they stay editable and can be saved again.
- Decision: "Speichern" is enabled only while at least one element is placed (and a document is open and not being replaced).
- Decision: at open, a PDF that pdf.js shows but pdf-lib cannot load is rejected with the German message "Diese PDF-Datei kann nicht bearbeitet werden." The previous state is kept, as with encrypted files.
- Decision: the save dialog suggests `<Name>_signiert.pdf` in the folder of the original (`<Name>` = source file name without `.pdf`).
- Decision: at insert time, every PNG is also embedded once with pdf-lib into a throwaway document. If that fails, it is rejected with the existing German PNG message, so saving never fails because of an image.

**Never:**
- No incremental/append save or signing; this story does no digital-signature detection (that is story 4).
- No place/date text (story 5).
- No Ctrl+S shortcut.
- No extra in-app question when overwriting the original. The OS save dialog's own overwrite confirmation is enough.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save | Signatures on pages 1 and 3, user saves as a new file | New PDF written; each signature at the preview's position, size and rotation; transparency preserved; source byte-identical | N/A |
| Dialog cancelled | User closes the save dialog | Nothing written | No message |
| Target = source | User changes the name back to the original and confirms the OS overwrite prompt | The original is replaced by the signed PDF (atomic temp + rename); the placements stay, and a second save works again from the unchanged in-memory source bytes | N/A |
| Rotated page | Signatures on /Rotate 90 and 270 pages with a CropBox offset, also rotated by 30° | Saved placement matches the preview | N/A |
| Overhang | Signature hanging over the page edge | Saved; the part outside the visible page is not shown (clipped by the CropBox, like the preview) | N/A |
| Shared image | The same PNG used 5 times | The image is embedded once and drawn 5 times | N/A |
| Write fails | Target folder not writable | No partial file left | German message: the file could not be saved |
| Build fails | pdf-lib throws while building | Nothing written; no dialog | German message: the PDF could not be created |
| No elements | PDF open, nothing placed (or all removed) | "Speichern" is disabled | N/A |
| pdf-lib cannot load | PDF that pdf.js renders but pdf-lib rejects | Not opened; previous state kept | German message: "Diese PDF-Datei kann nicht bearbeitet werden." |
| PNG not embeddable | PNG that passes the webview decode but pdf-lib `embedPng` rejects | Not inserted | Existing German PNG message |
| Suggested name | Source "Vertrag.pdf" | Dialog proposes "Vertrag_signiert.pdf" in the original's folder | N/A |

</frozen-after-approval>

## Code Map

- `src-tauri/src/lib.rs` -- `AppState.files().source` (set by `accept_opened_pdf`) gives the folder and the `<Name>` for the suggested `<Name>_signiert.pdf`; the backend derives both itself. The command pattern is `open_pdf` / `pick_signature_png` (async, `blocking_*` dialog, `spawn_blocking` file IO). Add `save_pdf`, which reads the raw body via `tauri::ipc::Request`. There is an existing test that every `build.rs` command is granted.
- `src-tauri/build.rs`, `src-tauri/capabilities/default.json` -- register and grant `save_pdf`.
- `src/backend.ts` -- typed wrappers; add `savePdf(bytes)` → saved file name, or `null` if cancelled. The backend derives the suggestion from the source path. Any error strings shared by Rust and TS are mirrored, and the tests assert the literals on both sides (see `EMPTY_FILE_ERROR`).
- `src/model.ts` -- `DocumentState.sourceBytes`, `sourceName`, `elements` (`rect` = unrotated box in PDF user space, `rotation` = degrees clockwise on the displayed page), `images` (id → bytes, pixel size).
- `src/ui/geometry.ts` -- `boxFromGeometry(viewport, geometry)` and `boxCorners(box)` (nw, ne, se, sw on screen). Reuse these for the save transform.
- `src/pdf/viewport.ts` -- `toPdfPoint`: the only screen → PDF conversion.
- `src/pdf/document.ts` -- `loadPdfDocument` / `isEncryptedForPdfLib` (swallows pdf-lib parse errors today, relevant to the open question). `LoadedPdf.proxy` gives `getPage(n).getViewport({ scale: 1 })`.
- `src/app.ts` -- `createApp` deps, `MESSAGES`, `editable()`, `refreshToolbar()`, and toolbar action dispatch (`save` is still unhandled). `messages.show` is error-styled, so a success notice needs an info variant.
- `src/signature/png.ts`, `src/signature/pngFixtures.test-data.ts` -- PNG validation and fixture builders (8-bit RGBA only today).
- `src/ui/toolbar.ts` -- the `save` action already exists, disabled.

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/lib.rs`, `build.rs`, `capabilities/default.json` -- `save_pdf` command:
  - raw body;
  - save dialog with the suggested name and the source folder;
  - empty payload = cancel;
  - temp file + rename, also over an existing file.
  
  Add Rust unit tests for the atomic write: a new target, replacing an existing file, and no leftover temp file after a failure.
- [x] `src/backend.ts` (+ test) -- `savePdf` wrapper and error literals mirrored with Rust.
- [x] `src/pdf/save.ts` (new, + test) -- `buildSignedPdf(sourceBytes, elements, images, pageViewports)`:
  - load a copy with pdf-lib;
  - embed each image once;
  - draw each placement with the transform from Design Notes;
  - `updateMetadata: false`.
  
  Pure, no DOM.
- [x] `src/pdf/save.test.ts` -- round-trip test: build PDFs with pdf-lib that have /Rotate 0/90/270 pages and CropBox offsets, place rotated signatures, and save. Then, for each drawn image, read its transform back via the pdf.js operator list (`getOperatorList`, the `transform` before `paintImageXObject`). Map the unit-square corners through the viewport and assert they equal `boxCorners` of the preview box (within 0.01 px). Also assert that the shared image is embedded once and that the source bytes are unchanged.
- [x] `src/app.ts`, `src/main.ts` (+ `app.test.ts`) -- the save flow:
  - build first, then `savePdf`;
  - busy state;
  - German messages (write failed, build failed);
  - success info message "Gespeichert: <Dateiname>";
  - toolbar enabling per decision.
- [x] `src/styles.css`, `index.html` -- info variant of the message bar.
- [x] `src/pdf/document.ts` (+ test) -- reject PDFs pdf-lib cannot load as a new error kind "uneditable", with the German message; `app.ts` maps it.
- [x] `src/signature/` (+ test) -- insert-time `embedPng` check. Fixtures cover 16-bit RGBA, indexed+tRNS, grey+alpha and interlaced PNGs: each is either embedded and saved correctly or rejected at insert.

**Acceptance Criteria:**
- Given signatures (one rotated 30°) on a /Rotate 90 page with a CropBox offset, when the PDF is saved, then pdf.js shows each image's corners at the preview's screen corners within 0.01 px.
- Given a file saved under the suggested name, when the original is compared byte-by-byte with its state before saving, then it is identical.
- Given 5 placements of one PNG, when saved, then the output contains exactly one image XObject for it.

## Implementation Notes

- `save_pdf` returns the saved file name as raw UTF-8 bytes; an empty payload means cancelled. Mirrored error literals: `no-document` (no accepted source) and `invalid-body` (body not raw, non-empty bytes). The frontend maps every save error to "Die Datei konnte nicht gespeichert werden."
- `write_atomically` writes `.ecpdfsign-<pid>-<n>.tmp` next to the target (short, so target names near the 255-character limit work) (`create_new`), `sync_all`s it, then `fs::rename`s it over the target; a guard removes the temp file on any error.
- `buildSignedPdf` saves with `useObjectStreams: false` (classic xref, readable by every viewer whatever the source's PDF version) and `updateFieldAppearances: false` (pdf-lib would otherwise regenerate form-field appearances). Non-signature elements throw (story 5 adds place/date). A page whose `/Contents` is an indirect array (possibly shared with other pages) gets a direct copy before drawing, because pdf-lib mutates that array in place.
- "uneditable" also covers a page-count mismatch between pdf-lib and pdf.js (e.g. a lying `/Count`), since signatures would otherwise land on the wrong pages.
- pdf-lib's PNG decoder (UPNG) under-allocates its inflate buffer for some interlaced sizes (13 x 9 fails, 16 x 16 works); such PNGs are refused at insert by `checkPngEmbeddable`. Animated PNGs are refused too.
- While saving, "PDF Öffnen", "PNG Unterschrift einfügen", "Element entfernen" and "Speichern" are disabled; the elements are snapshotted when the save starts. "Speichern" is also disabled while a PNG is being inserted. The "Gespeichert" notice is hidden on the next element change (move, remove, insert), but an error shown later is not.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | edge | Pages sharing one indirect `/Contents` array: the signature is pushed into the shared array, so it appears on every sharing page | medium | `PDFPageLeaf.normalize`/`addContentStream`/`wrapContentStreams` mutate the looked-up array in place (only a single-stream `/Contents` is replaced by a fresh direct array). **patch** |
| 2 | edge, verif-gap | `save()` ignores `inserting`, so a save started between PNG pick and insert misses the new signature but reports "Gespeichert" | low | `app.ts:325` checks `editable()` and element count only; a direct guard. **patch** |
| 3 | blind | The "Gespeichert: …" notice stays after later edits | low | `changed()` never hides the info notice; a direct fix. **patch** |
| 4 | blind, edge | Temp name embeds the full target name, so a target near 255 chars fails | low | `lib.rs` temp name `.{name}.{pid}-{n}.tmp`; a shorter fixed prefix is a direct correction. **patch** |
| 5 | blind | Write failure while the original is open in Acrobat or read-only shows only a generic message | low | Most likely failure when overwriting the original; extending the German text with a hint is a direct correction. **patch** |
| 6 | verif-gap | Message-bar info/error variant (`data-kind`, `role`) untested | medium | Pre-verified; logic lives untested in `main.ts`. **patch** (extract `ui/messageBar.ts` + happy-dom test) |
| 7 | verif-gap, blind | `save_pdf` command body/no-document/payload contract not run by any test | medium | Pre-verified; needs a live dialog and Tauri State. **defer** (extract pure functions later) |
| 8 | verif-gap, edge | postMessage IPC fallback delivers the body as JSON, so every save fails with `invalid-body` | maybe-false (medium if true) | The fallback only triggers when custom-protocol IPC fails; the CSP allows it. **defer** |
| 9 | blind, edge | Opaque annotations (stamps, filled widgets) overlapping a signature hide it in the saved file, while the preview shows it on top | low | Real z-order difference, but needs a signature placed over an opaque annotation; the fix (signature as a top-most annotation or flattening) is a design change. Rejected (reported to the user as a known limitation) |
| 10 | blind | Tagged PDF/UA and PDF/A sources: no `/Artifact` marking; PDF/A-1 claims kept with an SMask | low | Out of the app's scope; rare for documents people sign. Rejected |
| 11 | blind | No dirty tracking: the discard question appears even right after saving | low | Matches the story 2 rule ("elements placed → ask"); needs new state. Rejected |
| 12 | blind, edge | Rename over the original drops permissions, ACLs and xattrs and replaces symlinks | low | Typical user documents inherit folder ACLs; symlinked originals are rare; the fix adds platform code. Rejected |
| 13 | blind, edge | A crash or power loss can leave a hidden temp file | low | The target is never partial; leftover only on abort. Rejected |
| 14 | blind | Backend builds German error strings with the OS detail that the frontend never shows; duplicated `map_err` | low | Dead text only, no user harm. Rejected |
| 15 | blind | Interlaced (odd sizes) and animated PNGs refused with "konnte nicht als PNG-Bild geladen werden" although the webview shows them | low | Matches the approved decision (reject at insert with the existing PNG message); re-encoding is a new feature. Rejected (offered to the user as a follow-up) |
| 16 | blind | Spec Change Log empty, stale Code Map and SPEC lines | — | Fix edits the spec. Rejected |
| 17 | blind | Switching `role` alert/status on one element is not reliably announced | low | Needs two live regions; accessibility polish. Rejected |
| 18 | blind | `uneditablePdf()` test helper duplicated without a guard | low | Test-only, with a clear failure mode. Rejected |
| 19 | edge | Unbalanced q/Q in source content leaves a CTM after pdf-lib's wrap | low | Needs malformed content streams. Rejected |
| 20 | edge | A name typed without `.pdf` is saved without an extension | false | The Windows and macOS save dialogs append the filter's extension. |
| 21 | edge | Claim "a failed save never leaves a partial file" | low | The target is never partial; a temp file can survive only an abort (#13). Rejected |

## Design Notes

To get the save transform from the preview geometry, take the page viewport at scale 1 and compute the on-screen box with `boxFromGeometry` and its corners with `boxCorners`. Convert `sw`, `se` and `nw` with `toPdfPoint`. Then draw the image (unit square) with the matrix `[se−sw, nw−sw, sw]`:

```ts
const [nw, , se, sw] = boxCorners(boxFromGeometry(vp, el)).map((p) => toPdfPoint(vp, p));
page.pushOperators(pushGraphicsState(),
  concatTransformationMatrix(se.x - sw.x, se.y - sw.y, nw.x - sw.x, nw.y - sw.y, sw.x, sw.y),
  drawObject(imageName), popGraphicsState());
```

The page's `/Rotate`, the CropBox origin and the element's own rotation are already in those three points, so there is nothing else to compensate. If a page's content stream leaves a non-identity CTM, wrap the existing content first (pdf-lib does this when you draw via `page.pushOperators`, after normalizing). Verify it with the round-trip test.

## Verification

**Commands:**
- `npm run build` -- expected: tsc and vite build succeed.
- `npm test` -- expected: all vitest tests pass.
- `cargo clippy --all-targets` and `cargo test` (in `src-tauri/`) -- expected: no warnings, tests pass.

**Manual checks:**
- `npm run tauri dev`: place signatures, including a rotated one and one on a rotated page, and save. Then:
  - Open the result in Acrobat Reader / Edge and compare it with the preview.
  - Try to save over the original.
  - Cancel the save dialog.
