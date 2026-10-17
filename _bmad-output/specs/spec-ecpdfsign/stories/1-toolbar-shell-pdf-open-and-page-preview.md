---
title: 'Toolbar shell, PDF open and page preview'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1fe60fa5858264525fad6e8d8527edbbb482c627'
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app is still the create-tauri-app greet template. There is no way to open a PDF or see its pages, and every later story (signatures, texts, save) needs a document view to build on.

**Approach:** Replace the template with the German five-button toolbar. Implement "PDF Öffnen": a native file dialog, a left strip of lazily rendered page thumbnails (about 3 visible at once), and the selected page shown large on the right (SPEC CAP-1). Lock down the CSP and keep file access in the backend.

## Boundaries & Constraints

**Always:**
- The UI text is German.
- The toolbar has exactly five buttons, in this order: "PDF Öffnen", "Ort/Datum einfügen", "PNG Unterschrift einfügen", "Element entfernen", "Speichern". The last four stay disabled in this story.
- Fully local:
  - pdf.js, its worker, cMaps, and standard fonts are bundled.
  - The CSP allows no remote origin.
  - pdf.js runs with `isEvalSupported: false`.
- The frontend never sends file paths to the backend. The backend opens the dialog, remembers the chosen source path in app state, and returns the bytes. The source file is only ever read.
- Placed-element types are page-indexed and use PDF user-space units. Converting between screen and PDF coordinates goes only through the pdf.js page viewport, so rotation and CropBox offsets are handled in one place.

**Never:**
- No placement, saving, or text features (later stories).
- No zoom controls, drag-and-drop opening, or printing.
- No `fs` plugin with a broad scope, and no `withGlobalTauri`.
- Do not keep the template's `greet` command, the opener plugin, or the template assets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open normal PDF | User picks a 10-page PDF | Strip shows all pages (about 3 visible, the rest by scrolling). Page 1 is shown large on the right and marked in the strip. | N/A |
| Select page | User clicks thumbnail 7 | Page 7 is shown on the right; thumbnail 7 is marked. | N/A |
| Dialog cancelled | User closes the dialog | Current state is unchanged (empty state or previous PDF). | No message |
| Open another PDF | A PDF is open; user picks a new one | The new PDF replaces the old one; page 1 is selected; the strip scrolls to the top. | N/A |
| Password-protected | PDF needs a password to open | No document is loaded; the previous state is kept. | German message: password-protected PDFs are not supported yet |
| Owner-password only | Encrypted PDF that opens without a password (permission restrictions) | Rejected exactly like a password-protected PDF (decision: pdf-lib cannot save encrypted PDFs, so reject early). | Same German message as password-protected |
| Corrupt / not a PDF | Unparseable file | No document is loaded; the previous state is kept. | German message: the file could not be opened as a PDF |
| Window resize | A PDF is open; the window is resized | The main page re-fits and stays sharp; the strip keeps about 3 thumbnails visible. | N/A |

</frozen-after-approval>

## Code Map

- `index.html` -- template markup with greet form; replace with toolbar, thumbnail strip, page view, empty-state hint; `lang="de"`, title "ECpdfSign".
- `src/main.ts` -- template greet logic; becomes app bootstrap wiring toolbar → open flow → views.
- `src/styles.css` -- template styles; replace with layout (toolbar top, strip left, page view fills rest).
- `src/assets/*.svg` -- template logos; delete.
- `src-tauri/src/lib.rs` -- registers `greet` + opener plugin; replace with dialog plugin, app state holding source path, `open_pdf` command.
- `src-tauri/Cargo.toml` -- swap `tauri-plugin-opener` for `tauri-plugin-dialog`.
- `src-tauri/capabilities/default.json` -- swap `opener:default`; grant only what the commands need.
- `src-tauri/tauri.conf.json` -- `csp: null`, `withGlobalTauri: true`, window 800×600; harden and enlarge.
- `package.json` -- add `pdfjs-dist`, `vitest`; drop `@tauri-apps/plugin-opener`; add `test` script.
- `tsconfig.json` -- `lib`/`target` ES2020 may be too old for pdfjs-dist types; raise if needed.

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` -- add dialog plugin; `async` command `open_pdf` shows PDF-filtered open dialog, stores path in managed state, returns `None` on cancel or file name + raw bytes (`tauri::ipc::Response`, not a JSON number array); remove greet/opener -- backend owns file access.
- [x] `src-tauri/tauri.conf.json` -- strict CSP (self + ipc, worker/blob/data only as pdf.js needs), `devCsp` may allow Vite HMR; `withGlobalTauri: false`; window ~1280×860 with minimum size; productName/title "ECpdfSign" -- untrusted-input hardening.
- [x] `package.json`, `vite.config.ts`, `tsconfig.json` -- add pdfjs-dist with locally bundled worker, cMaps, standard fonts; add vitest + `npm test` -- local-only rendering, test runner for later stories.
- [x] `src/pdf/` (new) -- load document from bytes, classify errors (password vs. invalid), reject any encrypted PDF (detect via pdf-lib `PDFDocument.load` → `EncryptedPDFError`; add `pdf-lib` dependency), render page to canvas at devicePixelRatio, expose page viewport -- single pdf.js boundary.
- [x] `src/model.ts` (new) -- document state (source name, page count, selected page) and placed-element type (page index + PDF user-space rect), no elements created yet -- foundation for stories 2–5.
- [x] `src/ui/toolbar.ts`, `src/ui/thumbnails.ts`, `src/ui/pageView.ts` (new) -- toolbar with disabled buttons; IntersectionObserver-driven lazy thumbnails sized to ~1/3 strip height, selection mark; fit-page main view re-rendered on resize -- CAP-1 UI.
- [x] `index.html`, `src/main.ts`, `src/styles.css`, `src/assets/` -- replace template; German empty-state hint and error messages -- shell.
- [x] `src/pdf/*.test.ts` -- unit-test error classification and viewport point conversion round-trip on rotated (90°) and CropBox-offset viewports -- I/O matrix + coordinate foundation.

**Acceptance Criteria:**
- Given the app is started without a document, when it shows, then the five German buttons are visible, only "PDF Öffnen" is enabled, and the page area shows a hint to open a PDF.
- Given a 200-page PDF, when it is opened, then page 1 appears without waiting for all thumbnails, and thumbnails render as they scroll into view.
- Given the built app, when a PDF is opened and browsed, then the webview console shows no CSP violations and no network requests leave the machine.

## Implementation Notes

- Added `accept_opened_pdf`. The picked path becomes the source only after the frontend has loaded the file, so a rejected file never replaces the source of the document still on screen.
- `build.rs` declares both commands in `AppManifest`. The capability grants only `allow-open-pdf` and `allow-accept-opened-pdf`; `core:default` was dropped.
- Encryption is detected with pdf-lib `load({ ignoreEncryption: true })` + `isEncrypted`, plus the pdf.js `EncryptFilterName` check. `instanceof EncryptedPDFError` never matches, because pdf-lib's errors are ES5 subclasses. Behavior is equivalent to the planned `EncryptedPDFError` check.
- pdfjs-dist 6 removed `isEvalSupported` and no longer uses eval. The flag is still passed, and the CSP without `'unsafe-eval'` enforces it.
- pdf.js is imported only via the legacy build (`src/pdf/pdfjs.ts`), which polyfills `Uint8Array.prototype.toHex` for older macOS WebViews and for Node.
- The open/select flow lives in `src/app.ts` (dependencies injected); `main.ts` only wires it up. The thumbnail slot maths is in `src/ui/layout.ts`.
- `happy-dom` is used only for the DOM tests of the UI modules. The encrypted fixtures in `src/pdf/encryptedFixtures.test-data.ts` were generated with pypdf.
- `cargo test` (4 Rust tests) also runs as verification.
- macOS is untested.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | blind, edge | `vite.config.ts` dev middleware: `%5C..` traversal escapes `pdfjs-dist` | medium | Reproduced: `path.join(root,'cmaps','a\\..\\..\\..\\package.json')` → outside root. **patch** |
| 2 | verif-gap | Toolbar labels/order/disabled state and `handleToolbarAction("open")` untested (AC1) | medium | Pre-verified, no test imports `ui/toolbar`. **patch** |
| 3 | verif-gap, blind | Lazy thumbnail render path never runs in tests (IntersectionObserver stubbed) (AC2) | medium | Pre-verified. **patch** |
| 4 | verif-gap, blind | `pageView.ts` untested (empty hint, `showPage`, stale-render guard) | medium | Pre-verified. **patch** |
| 5 | verif-gap | `open_pdf` payload format checked only against a TS mirror, with no shared golden vector | medium | Pre-verified. **patch** |
| 6 | verif-gap | pdf.js asset prefix/dirs duplicated in `setup.ts` and `vite.config.ts`, unchecked | low | Pre-verified; drift would 404 the CMaps and fonts. **patch** (shared constants) |
| 7 | blind | Old error banner stays visible when a new open is started and then cancelled | low | `openPdf` hides the message only on success; a one-line fix. **patch** |
| 8 | blind, edge | Any string rejection from `pickPdf` (raw OS or English IPC text) is shown verbatim | low | `app.ts` shows `error` when it is a string; the fix is a direct correction. **patch** |
| 9 | verif-gap | Command ↔ capability grant not checked automatically | medium | Pre-verified; needs an e2e harness. **defer** |
| 10 | blind | PDFs pdf.js opens but pdf-lib cannot parse are accepted and fail later at save | maybe-false (medium if true) | No save exists yet; frequency needs a test corpus. **defer** to story 3 |
| 11 | edge | Awaiting `previous.pdf.destroy()` inside the open lock could hang "PDF Öffnen" | maybe-false (medium if true) | pdf.js terminates the worker after its current task; whether it can hang forever is unverified. **defer** |
| 12 | edge | Thumbnail `running` slots leak if an old `getPage` never settles after destroy | maybe-false (medium if true) | Needs a check of pdf.js destroy semantics for pending `getPage`. **defer** |
| 13 | blind | CLAUDE.md says vitest uses Node, but `thumbnails.test.ts` uses happy-dom | low | Fix edits an agent-context file. **defer** |
| 14 | blind | Double parse and byte copies slow down opening large PDFs | low | pdf-lib parses in chunks, so the delay applies only to big files and the fix restructures loading. Rejected |
| 15 | blind, edge | No file-size limit in `open_pdf` | low | A multi-GB `.pdf` is unlikely and the fix adds a guard. Rejected |
| 16 | blind | pending/accept handshake not tied to one open | false | The `opening` lock serializes opens, and every accept follows its own `open_pdf`, which overwrites `pending`. |
| 17 | blind | `current` is swapped before the views; a throwing view would leave the state inconsistent | false | The view `setDocument` calls build DOM only; no throw path is shown to be reachable. |
| 18 | blind, verif-gap | `encryptedFixtures.test-data.ts` is missing from the diff | false | Excluded from the review diff on purpose (base64 blob); the file is on disk, documents how it was generated, and will be committed. |
| 19 | blind | Autogenerated permission TOMLs committed with no guidance | low | Harmless; they regenerate on build. Rejected |
| 20 | blind | `vite.config.ts` is not type-checked | low | Pre-existing `include: ["src"]`; the fix adds a tsconfig. Rejected |
| 21 | blind, edge | `devCsp` lacks the `TAURI_DEV_HOST` HMR origin | low | Affects remote/mobile dev only. Rejected |
| 22 | blind, edge | Story verification and notes drift (cargo test, encryption mechanism) | — | Fix would edit the spec. Rejected; deviations are recorded in Implementation Notes |
| 23 | blind | The page is clipped for ~100 ms while shrinking | low | Transient; `max-width` on the canvas would break overlay coordinates. Rejected |
| 24 | blind | Toolbar roving focus, 200 tab stops, PageUp = arrow, disabled-button contrast | low | WCAG exempts disabled controls; the rest needs new keyboard handling. Rejected |
| 25 | blind | Accept-IPC failure shows "konnte nicht gelesen werden" | low | Only on internal IPC failure. Rejected |
| 26 | edge | Worker/setup failures are reported as "invalid PDF" | low | Only on a broken install; the fix adds an error category. Rejected |
| 27 | edge | Malformed `%` encoding throws in the middleware (500) | low | Dev-only; connect turns it into a 500. Rejected |
| 28 | edge | A read-stream error can crash the dev server | low | Needs the file removed between stat and read. Rejected |
| 29 | edge | A missing pdf.js asset dir aborts the build | false | A loud build failure after a dependency change is correct behavior. |
| 30 | edge | Error placeholder written to a thumbnail that scrolled away is never retried | false | The retry would hit the same `getPage` error; the placeholder is the correct result. |
| 31 | edge | `thumbnailSlotHeight` with `visible <= 0` | false | Only called with the constant 3. |
| 32 | verif-gap | The two encryption detectors are not pinned individually | low | Behavior is correct; a single-detector fixture is impractical. Rejected |

## Design Notes

Use `blocking_pick_file` only inside an `async` command: sync commands run on the main thread and would deadlock the dialog. Store pdf.js viewport transforms per page, never ad-hoc scale math. Story 3 depends on `convertToPdfPoint` and `convertToViewportPoint` being the only conversions.

## Verification

**Commands:**
- `npm run build` -- expected: tsc and vite build succeed.
- `npm test` -- expected: all vitest tests pass.
- `cargo clippy` (in `src-tauri/`) -- expected: no warnings.

**Manual checks:**
- `npm run tauri dev`: walk the I/O matrix with a multi-page PDF, a password-protected PDF, a rotated-page PDF, and a non-PDF renamed to `.pdf`.
