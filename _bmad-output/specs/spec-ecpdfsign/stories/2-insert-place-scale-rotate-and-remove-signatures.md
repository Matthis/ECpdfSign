---
title: 'Insert, place, scale, rotate and remove signatures'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ff499d11bb4ce041b7920a917b14ab5af90a047c'
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A PDF can be opened and browsed, but no signature can be put on it. "PNG Unterschrift einfügen" and "Element entfernen" are still disabled.

**Approach:**
- "PNG Unterschrift einfügen" loads a PNG via a native dialog and places it on the current page as an overlay, with its transparency intact.
- An active signature shows a frame. The frame scales it, a rotation handle above the frame rotates it, and an "×" in the frame's top-left corner removes it.
- Any number of signatures can be placed on any pages (SPEC CAP-2, CAP-3, CAP-6).
- Geometry is stored in PDF user space, so story 3 saves exactly what is shown.

## Boundaries & Constraints

**Always:**
- The backend owns the PNG dialog and the file read and returns only bytes. The frontend never sends paths.
- Each element stores:
  - its unrotated box (`rect`, in PDF user space);
  - `rotation` in degrees, clockwise as seen on the displayed page, about the box center.
- Screen positions are derived only through `src/pdf/viewport.ts`. The model is updated as the user interacts.
- At 0° the image is upright relative to the displayed page, including on rotated pages.
- Moving happens only while the signature is grabbed with the **left** mouse button held down. The pointerdown selects it and starts the drag; releasing ends it. Other buttons do nothing.
- An active (selected) signature shows a frame that rotates with it. The frame has:
  - 4 corner handles that scale with a fixed aspect ratio, keeping the opposite corner fixed;
  - 4 edge handles that change only width or height, keeping the opposite edge fixed;
  - an "×" button in the top-left corner that removes the signature;
  - a round rotation handle above the top-center, joined to the frame by a short line.
- The rotation handle:
  - rotates about the center;
  - shows the angle as a badge (e.g. "12°") while dragging;
  - snaps to 0°, 90°, 180° or 270° within ±3°;
  - moves in 15° steps while Shift is held;
  - resets to 0° on double-click.
- The toolbar:
  - "PNG Unterschrift einfügen" is enabled only while a document is open.
  - "Element entfernen" is enabled only while an element is selected.
- A newly inserted signature:
  - is selected and has 0° rotation;
  - is centered on the current page;
  - is 25% of the displayed page width, keeping the PNG's aspect ratio.
- Identical PNG bytes are stored once and shared, so story 3 embeds each image once.
- Signatures may hang over the page edge:
  - At least 16 CSS px of the rotated bounding box stays on the page in both directions, so it can be grabbed again.
  - The image is clipped to the page area, because that is what will be saved.
  - The frame, handles, "×" and angle badge are never clipped.
- The minimum size is 16 CSS px on the short side.
- Opening another PDF while elements are placed asks first, in an in-app `<dialog>` (not `window.confirm`): "Platzierte Elemente verwerfen?" with "Verwerfen" / "Abbrechen". "Abbrechen" changes nothing and shows no file dialog. With no elements placed, there is no question.
- Entf/Backspace removes the selected element and Esc deselects it, unless focus is in a text input.

**Never:**
- No saving, place/date text, or signatures in the thumbnails.
- No undo/redo.
- No image formats other than PNG.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Insert | PDF open, transparent PNG picked | Centered on the current page at the default size, 0°, selected with its frame; the page shows through transparent areas | N/A |
| Dialog cancelled | User closes the PNG dialog | Nothing changes | No message |
| Not a PNG / corrupt | File does not decode as PNG | Nothing is added | German message: the file could not be loaded as a PNG |
| No document | No PDF open | "PNG Unterschrift einfügen" is disabled | N/A |
| Drag | Left button pressed on a signature, pointer moved, released | Selects it, follows the pointer only while the button is held, stops on release | N/A |
| Other button | Right or middle button on a signature | No move | N/A |
| Corner handle | Drag a corner (also when rotated) | Scales with a fixed aspect ratio; the opposite corner stays put on screen | N/A |
| Edge handle | Drag an edge (also when rotated) | Only width or height changes along the signature's own axis; the opposite edge stays put | N/A |
| Too small | Shrink below the minimum | Stops at 16 px on the short side | N/A |
| Rotate | Drag the rotation handle | Rotates about the center; angle badge shown; snaps near 0/90/180/270°; Shift gives 15° steps | N/A |
| Reset rotation | Double-click the rotation handle | Rotation becomes 0° | N/A |
| Overhang | Drag past the page edge | May hang over; at least 16 px stay on the page; the image is clipped to the page; the frame is not | N/A |
| Select / deselect | Click a signature / click empty page area / Esc | Frame shown / hidden; "Element entfernen" enabled / disabled | N/A |
| Remove | "×" in the frame, "Element entfernen", or Entf/Backspace | Gone from page and model; nothing selected | N/A |
| Page switch | Signatures on pages 2 and 5 | Only the current page's signatures are shown, unchanged when returning | N/A |
| Window resize | Signatures placed, window resized | Same page-relative position, size and rotation | N/A |
| Rotated page | /Rotate 90 page with a CropBox offset | Move, scale and rotate behave as on unrotated pages; the stored geometry round-trips to the same screen box and angle | N/A |
| Many | 20 signatures across pages | All coexist and are individually selectable | N/A |
| Open another PDF | Elements placed, "PDF Öffnen" | Modal; "Abbrechen" keeps everything and shows no file dialog; "Verwerfen" continues to the file dialog | N/A |

</frozen-after-approval>

## Code Map

- `src-tauri/src/lib.rs` -- `open_pdf` is the pattern to follow (async, `blocking_pick_file`, `spawn_blocking` read, raw `Response`). Add `pick_signature_png` the same way: PNG filter, empty payload = cancel, bytes only, no state.
- `src-tauri/build.rs`, `src-tauri/capabilities/default.json` -- every new command must be listed in `AppManifest` and granted (`allow-pick-signature-png`).
- `src/backend.ts` -- typed wrappers; add `pickSignaturePng(): Promise<Uint8Array | null>`.
- `src/model.ts` -- `PlacedElement` (id, kind, pageIndex, `PdfRect`), `DocumentState.elements`. Extend with `rotation`, an image store (id → bytes, pixel size), `imageId`, and pure add/update/remove/list-by-page helpers.
- `src/app.ts` -- `createApp` with injected deps, `MESSAGES`, toolbar enabling, and the open flow (`createDocumentState` resets elements). Add the insert/remove/select flow and the discard modal here.
- `src/ui/pageView.ts` -- owns `stage` and the fitted viewport (`getShownPage`) and re-renders on resize and page switch. Add a "viewport shown" notification so the overlay re-lays out.
- `src/pdf/viewport.ts` -- `toPdfRect` / `toViewportRect`: the only screen↔PDF conversions.
- `src/ui/toolbar.ts` -- `setEnabled` for `insertSignature` / `removeElement`.
- `src/styles.css` -- `.page-stage` is `position: relative`; `.page-view` has `overflow: hidden` and 24 px padding.
- Tests: node env with fakes for `app.test.ts`; `// @vitest-environment happy-dom` for UI modules (see `src/ui/pageView.test.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/lib.rs`, `build.rs`, `capabilities/default.json` -- `pick_signature_png` + Rust test of the cancel/empty contract -- backend owns file access.
- [x] `src/backend.ts` (+ test) -- `pickSignaturePng` wrapper.
- [x] `src/signature/png.ts` (new, + test) -- validate PNG magic bytes and IHDR, read pixel size, reject corrupt or non-PNG files -- pure.
- [x] `src/model.ts` (+ test) -- `rotation`, image store with byte-identical dedupe, `imageId`, pure helpers -- single source of truth.
- [x] `src/ui/geometry.ts` (new, + test) -- pure viewport-space math on a rotated box (center, w, h, angle):
  - move;
  - corner resize with locked aspect and edge resize, both in element-local axes with the opposite corner or edge fixed;
  - min size;
  - keep ≥16 px of the rotated bounding box on the page;
  - rotation from pointer angle, with snapping, Shift steps and normalization to [0, 360);
  - default placement;
  - all interaction maths, tested without a DOM.
- [x] `src/ui/overlay.ts` (new, + happy-dom test) -- the current page's signatures as blob-URL `<img>` elements in a page-clipped layer, plus an unclipped frame layer:
  - frame, 8 handles, "×", rotation handle and angle badge;
  - left-button pointer-capture interactions;
  - re-layout on viewport change;
  - blob URLs revoked on removal or document change;
  - covers CAP-3 / CAP-6 UI.
- [x] `src/ui/pageView.ts` -- notify listeners when a new viewport is shown.
- [x] `src/app.ts`, `src/main.ts`, `index.html` (+ `app.test.ts`) -- insert/remove/select flow, toolbar enabling, German PNG error, Entf/Backspace/Esc, the discard `<dialog>` -- wiring.
- [x] `src/styles.css` -- overlay, frame, handles, "×", rotation handle, badge, cursors -- visuals.

**Acceptance Criteria:**
- Given a PDF is open, when a transparent PNG is inserted on page 3, then it shows centered on page 3, selected with its frame, with the page visible through its transparent pixels.
- Given a signature rotated 30° on a page with /Rotate 90, when it is moved and resized, then its stored geometry converts back to the on-screen box and angle (within 0.01 px / 0.01°).
- Given 20 signatures on several pages, when switching pages and resizing the window, then each keeps its page-relative position, size and rotation.

## Implementation Notes

- `pick_signature_png` returns `Err("empty-file")` for a 0-byte file, because an empty payload already means "cancelled". `pickSignaturePng` turns that error into zero bytes, so the app shows the German PNG message.
- PNG validation is a structural check (`readPngInfo`: signature, IHDR, chunk CRCs, IDAT, IEND). The real app then also decodes the PNG in the webview (`createImageBitmap`) before placing it.
- The model helpers (`addImage`, `addSignature`, `updateElementGeometry`, `removeElement`, `selectElement`) are DOM-free and change only the state object they get. `DocumentState` gains `selectedElementId`, `images` and `nextId`. An image is dropped once no signature uses it, so story 3 embeds only images that are actually used.
- The "×" sits just outside the top-left corner, so it does not cover the `nw` corner handle, and its glyph is counter-rotated so it stays upright.
- `.page-view` is now `overflow: visible`, so frames are not clipped at the page edge or at the page-view padding. Stacking order: canvas and images (1) < frame layer (2) < toolbar, message bar and strip (3). The controls therefore stay clickable on top of an overhanging frame, and a stale, larger canvas during a window resize slides under them.
- `pageView` swaps only its own canvas or error node, so the overlay layers in the stage survive re-renders.
- Switching pages clears a selection that is not on the new page, and `selectElement` ignores elements of other pages, so "Element entfernen" never removes an element the user cannot see.
- While another PDF is being opened (after "Verwerfen"), inserting, removing and the shortcuts do nothing, and both buttons are disabled.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | blind, edge | Selection frame layer (z 3, `.page-view` overflow visible) covers the toolbar and thumbnail strip and swallows clicks when a signature hangs over the page's left or top edge | medium | `styles.css`: `.overlay-frames` z-index 3 > toolbar/strip z 2, and the frame takes pointer events. "Never clipped" means not clipped by the page. **patch**: frames go under the toolbar, message bar and strip |
| 2 | verif-gap | Rotation drag is never tested with a non-zero stage offset (`startPointer` uses `stageRect`) | medium | Pre-verified; happy-dom puts the stage at (0,0). **patch** |
| 3 | verif-gap | pageView render-failure path (`notify(null)`, overlay layers survive `showMessage`) untested | medium | Pre-verified. **patch** |
| 4 | verif-gap | Granting `allow-*` for every AppManifest command is unchecked (`pick_signature_png` too) | medium | Pre-verified; an `include_str!` test is cheap. **patch** (also covers story 1's deferred item) |
| 5 | verif-gap, blind | `EMPTY_FILE_ERROR` only compared to each side's own constant | low | Pre-verified. **patch**: assert the literal on both sides |
| 6 | blind | Double-click rotation reset skips `keepOnPage`, so an overhanging box can end with <16 px on the page | low | `overlay.ts` dblclick calls `boxToGeometry` without `keepOnPage`; a one-call fix. **patch** |
| 7 | blind | Insert/remove stay possible while a replacement PDF is loading after "Verwerfen" | low | `refreshToolbar` and `handleShortcut` ignore `opening`; a direct fix. **patch** |
| 8 | edge | Clicking the old page's signature before the new page has rendered selects an element on a page that is not shown, which Entf then removes invisibly | low | `selectElement` does not check `pageIndex` against `selectedPageIndex`; a one-line guard. **patch** |
| 9 | verif-gap | `main.ts` wiring (viewport → overlay, keydown) untested | medium | Pre-verified; needs a testable `wire()` refactor. **defer** |
| 10 | blind | PNG variants (16-bit, indexed, grey+alpha, interlaced) never shown to embed with pdf-lib | maybe-false (medium if true) | Story 3 concern; webview decode already rejects undecodable files. **defer** to story 3 |
| 11 | blind, edge | `keepOnPage` after resize/rotate shifts the center near the edge, so the fixed corner moves | low | Happens only when the 16 px rule would otherwise break; satisfying that frozen rule is the intended trade-off. Rejected |
| 12 | blind, edge | No PNG byte or pixel cap | low | The user picks their own signature file; the fix adds guards. Rejected |
| 13 | blind, edge | Non-PNG failures (getPage, addSignature) show the "not a PNG" message | low | Needs a page-load failure during insert. Rejected |
| 14 | blind, edge | Very flat PNGs (≥100:1) enlarged to the 16 px minimum become wider than the page | low | Unrealistic for signatures; the cap conflicts with the minimum. Rejected |
| 15 | blind, edge | A signature under the selected frame cannot be clicked; repeated inserts stack | low | Esc or a click on empty area deselects first; hit-testing adds complexity. Rejected |
| 16 | blind | contenteditable branch of the keyboard check not asserted | low | The app has no contenteditable. Rejected |
| 17 | blind | After "Verwerfen" + a cancelled or failed open, the old document stays | false | Keeping the document when nothing new opened is the correct "failure keeps current document" behavior. |
| 18 | blind | Drag-ending paths (pointercancel, removal mid-drag) untested | low | Code paths are simple listener removals. Rejected |
| 19 | blind | Overlay has no keyboard or screen-reader access | low | Out of the story's interaction scope; large addition. Rejected |
| 20 | blind | No drag threshold, so 1 px jitter on click moves the signature | low | Sub-pixel/1 px changes are invisible. Rejected |
| 21 | blind | Handles crowd at the 16 px minimum | low | Cosmetic at an extreme size. Rejected |
| 22 | edge | `showModal()` throwing leaves `pending` stuck | false | The `opening` lock and `confirming` flag make a second concurrent `ask()` unreachable; the dialog is static in `index.html`. |
| 23 | edge | `confirmDiscard` rejection is unhandled | false | It only rejects via #22, which is unreachable. |
| 24 | edge | After a page render failure the frame is hidden but the selection is removable | low | Needs a render failure while selected. Rejected |
| 25 | edge | Thin rotated signature in a corner: AABB overlap without pixels | low | Polygon-based clamping adds complexity for a rare case. Rejected |
| 26 | edge | Shrinking the window reduces the visible overlap below 16 CSS px | low | Overlap scales with the page; still grabbable in practice. Rejected |
| 27 | edge | Pointer crossing the exact box center makes the rotation jump | low | Momentary and needs an exact hit. Rejected |

## Design Notes

- Do all interaction maths in viewport space (CSS px, y down) on a box described by center, width, height and angle. Convert the unrotated box once with `toPdfRect` and store it together with `rotation`. Never accumulate deltas in PDF space: on rotated pages the PDF axes are swapped and flipped.
- Story 3 combines the page `/Rotate` and the element's `rotation` when drawing, so that the image appears exactly as shown.
- To resize a rotated box, project the pointer delta onto the element's local axes, resize, then shift the center so the fixed corner or edge keeps its screen position.

## Verification

**Commands:**
- `npm run build` -- expected: tsc and vite build succeed.
- `npm test` -- expected: all vitest tests pass.
- `cargo clippy --all-targets` and `cargo test` (in `src-tauri/`) -- expected: no warnings, tests pass.

**Manual checks:**
- `npm run tauri dev`, then:
  - insert a transparent PNG and drag it with the left button only;
  - use the corner and edge handles, also after rotating;
  - rotate with snapping and Shift, and double-click to reset;
  - remove a signature with "×", the button and Entf;
  - place signatures on several pages, including a rotated page;
  - resize the window;
  - open another PDF and choose "Abbrechen", then repeat and choose "Verwerfen".
