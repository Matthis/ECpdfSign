---
title: 'Post-test fixes: broken text glyphs, needless discard prompt, moving a text while editing'
type: 'bugfix'
created: '2026-10-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '9ac6c6ed5cacdd08b930a8c7f26a54e9e8fa623c'
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three issues from the user's manual test.
- Saved place/date texts are garbled: "München, 18.10.2026" reopens as "   e   1   1   6". The preview is correct.
- Right after a successful save, "PDF Öffnen" still asks "Platzierte Elemente verwerfen?".
- A place/date text in edit mode (just inserted, or reopened by double-click) cannot be dragged; the user must deselect and reselect it first.

**Approach:**
- Fix the bundled font so pdf-lib's subsetting keeps every glyph intact.
- Track unsaved changes and ask before discarding only when there are some.
- Make a text movable while its editor is open, without ending the edit.

## Boundaries & Constraints

**Always:**
- The saved text looks like the preview, with the same glyphs.
- Glyphs and metrics (ascent, descent, advances) stay the same. Only the font file's layout changes.
- Text is still embedded as a subset.
- Copying the text out of the saved PDF still yields the typed characters.
- Any element change since the last successful save counts as unsaved:
  - insert;
  - move, resize, rotate;
  - text edit;
  - remove.
- Selection and page changes do not count.
- While the editor is open, dragging keeps the typed, uncommitted input and the input focus. The move goes through the same `keepOnPage` rule as any drag.
- **Decision (user):** while a text is being edited, its normal frame stays visible: corner handles, rotation handle and "×". The frame keeps a few px of margin around the inputs, and that margin shows the "move" cursor.
  - Dragging the margin or the ", " separator moves the text.
  - Corners scale it and the rotation handle rotates it.
  - The editor stays open and follows the box.

**Never:**
- Embed the full 430 KB font (`subset: false`).
- Patch or fork `@pdf-lib/fontkit`.
- Add a new toolbar button.
- Change the confirm dialog's wording.
- Touch the other confirm flow (signature warning).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Saved text | "München, 18.10.2026" and "Łódź, Ærøskøbing, Zürich", saved | Every glyph of the embedded subset has the outline of the source font's glyph | N/A |
| Open after save | Elements placed, saved successfully, no change since | "PDF Öffnen" opens the file dialog directly | N/A |
| Change after save | Saved, then any element inserted/moved/resized/rotated/edited/removed | "PDF Öffnen" asks first | N/A |
| Save not completed | Save dialog cancelled, or build/write failed | Still asks | N/A |
| Change during save | Element changed while the file was being built | Still asks; the saved file lacks that change | N/A |
| Open after open | New PDF opened, nothing placed | No question (as today) | N/A |
| Drag while editing | Editor open with typed but uncommitted text | The text moves; the editor follows, keeps its input and focus; Enter afterwards commits at the new position | N/A |

</frozen-after-approval>

## Code Map

- `src/assets/fonts/NotoSans-Regular.ttf`: the bundled font. 1089 of its 3884 glyphs have an odd byte length; that is fine in the source, which uses long `loca` offsets. Fontkit's `TTFSubset._addGlyph` (`node_modules/@pdf-lib/fontkit/dist/fontkit.umd.js` ~40881) concatenates glyph data unpadded. `loca.preEncode` then picks short offsets (`offset / 2`) for a small subset, so every glyph after an odd one is misread. The fix is verified: re-saving with fontTools and `glyf.padding = 4` gives 0 odd glyphs, metrics unchanged (upm 1000, ascent 1069, descent −293), and subset outlines identical to the source for the 32 test characters. Command: `uv run --no-project --with fonttools python -I -c "from fontTools.ttLib import TTFont; import sys; f=TTFont(sys.argv[1]); f['glyf'].padding=4; f.save(sys.argv[2])" in.ttf out.ttf`.
- Font file users:
  - `src/placeDate/font.ts:5` (`?url`);
  - `src/styles.css:9` (`@font-face`);
  - `src/placeDate/fontFixture.test-data.ts` (`?inline`, `FONT_BYTES`, `bundledFont()`).
- `src/pdf/save.ts:117-120`: `embedFont(..., { subset: true, features: TEXT_FEATURES })`. Keep as is.
- `src/pdf/save.test.ts:~420-530`: text save tests. They check `getTextContent` (ToUnicode) only, which is why this bug passed. Reuse `fontDescriptors()` style lookups and `bundledFont()`.
- `src/model.ts:69` `DocumentState`, and its mutators: `addSignature`, `addPlaceDate`, `updateElementGeometry`, `removeElement`, `updatePlaceDateText`. These are the single place to count changes.
- `src/app.ts`:
  - `openPdf()` ~274: the `elements.length > 0` check before `confirmDiscard`.
  - `save()` ~561: elements are snapshotted before build; success is reached after `savedName !== null`.
  - `dropSavedNotice()` 231 marks the same mutation points.
- `src/ui/overlay.ts`:
  - `layout()` ~341-356: in edit mode the frame is hidden (`selected.id === editing?.id`) and the span is invisible; the editor takes its place.
  - `frame` pointerdown 186 starts a move only when `target === frame`.
  - `startDrag` 378 calls `preventDefault` on pointerdown; that does not stop a focus change in Chromium. `mousedown` must be prevented to keep the input focused.
- `src/ui/placeDateEditor.ts`:
  - `onOutsidePointerDown` (capture phase on `document`) commits on any pointerdown outside `root`. The frame/grip must be exempt.
  - `focusout` commits when focus leaves `root`.
  - `position()` places the editor from the box, so it follows a moved box on the next `layout()`.
  - The editor is usually wider than the text box: its inputs are sized in `ch`, and the date input has a picker icon. While editing, the frame must therefore enclose the editor's measured size plus the margin, not just the text box.
  - The drag still updates only the text's geometry, but while editing the drag maths runs on the **editor area**, not on the text box (see Design Notes).
- `src/ui/overlay.ts`:
  - `removeButton` (the frame's "×") is a focusable `<button>` before the editor in DOM order. While editing, Shift+Tab from the place input would land on it.
  - `rotateHandle` dblclick (~178) resets the rotation by round-tripping the box through the viewport even when it is already 0°. Float drift in that round trip counts as a change.
- `src/ui/geometry.ts`: `resizeBox` 116, `rotateBox` 191, `scaleTextBox` 260 are reused unchanged.
- `_bmad-output/implementation-artifacts/deferred-work.md:31-33`: the deferred "composite glyph subset" item. This spec settles it.

## Tasks & Acceptance

**Execution:**
- [x] `src/assets/fonts/NotoSans-Regular.ttf`: replace it with the padded re-save (command in the Code Map). Fixes the glyph shifting at its source.
- [x] `src/assets/fonts/README.md`: new. Record the source, the OFL license, that the file was re-saved with 4-byte glyph padding and why, and the command.
- [x] `src/placeDate/metrics.test.ts` (or a new `font.test.ts`): add a test that every glyph of the bundled font has an even byte length. This guards against a font swap.
- [x] `src/pdf/save.test.ts`: add a test that the subset font in the saved PDF draws "München, 18.10.2026" and "Łódź, Ærøskøbing, Zürich" with the source glyph outlines. Extract `FontFile2`, decode glyph ids from the content stream (or `encodeText`), and compare each glyph's path commands with `bundledFont()`'s glyph for that char. Without the font fix this test must fail.
- [x] `src/model.ts` (+ `model.test.ts`): add a change counter to `DocumentState` (e.g. `revision`, `savedRevision`). Every element mutator bumps it; selection and page changes do not.
- [x] `src/app.ts` (+ `app.test.ts`):
  - `save()` records the revision of its snapshot and marks it saved only on success.
  - `openPdf()` asks only if there are elements and unsaved changes.
  - Test every I/O matrix row for open/save.
- [x] `src/ui/overlay.ts`, `src/ui/placeDateEditor.ts`, `src/styles.css` (+ tests): implement moving, scaling and rotating while editing per the frame decision in Boundaries. Frame "×" while editing removes the text, as it does when the text is merely selected. Exempt the grab area from the editor's outside-pointerdown and focusout commits, and keep the input focused. Test that the editor stays open with its typed value, that the element moved, and that Enter then commits at the new position.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md`: mark the composite-glyph entry as resolved by this spec.
- [x] `src/ui/overlay.ts` (+ `overlay.test.ts`): while editing, run move, corner scaling and rotation on the editor area per Design Notes, so the grabbed corner stays under the pointer, the opposite frame corner stays put, and the rotation pivot is the frame's center. Tests assert the grabbed frame corner follows the pointer, the opposite corner stays, and the frame center stays while rotating.
- [x] `src/ui/overlay.ts`, `src/ui/placeDateEditor.ts`, `src/styles.css` (+ tests): editing robustness.
  - The editor's grab state is set only by a left-button pointerdown.
  - The frame's "×" has `tabIndex = -1`, so Tab/Shift+Tab never focus it.
  - The separator gets `touch-action: none`.
  - The rotation-handle dblclick does nothing when the rotation is already 0.
  - Tests:
    - after a released grab (`pointerup`, and `pointercancel`), a `focusout` to an outside target commits;
    - a right-button pointerdown on the frame does not block that commit;
    - a pointerdown on the frame or a handle is not cancelled while editing, and is cancelled when the text is only selected (make the test `pointer()` helper return its event).
- [x] `src/app.ts` (+ test): `dropSavedNotice()` hides the "saved" notice only if `hasUnsavedChanges(state)`. A no-op update (e.g. a drag pinned at the edge) keeps the notice.
- [x] `src/assets/fonts/README.md`: narrow "Nothing else changes" to what was checked: outlines, glyph order, advances and vertical metrics are unchanged; fontTools may update `head.modified`, checksums and bounding boxes.

**Acceptance Criteria:**
- Given "München, 18.10.2026" saved, when the PDF is opened in Acrobat or Edge, then it reads exactly that.
- Given the editor is open, when the user drags the text, then no commit or cancel is reported until Enter, Esc, Tab or a click elsewhere.

## Implementation Notes

- Font: re-saved with fontTools `glyf.padding = 4` (0 odd glyphs; glyph data, glyph order, hmtx and vertical metrics compared identical to upstream). `src/pdf/save.test.ts` ("embeds a subset whose glyphs have the source font's outlines") and the even-length test in `src/placeDate/metrics.test.ts` both fail against the old file. Outlines are compared via fontkit `path.toSVG()`, since the typings lack `path.commands`.
- Model: `revision`/`savedRevision` plus `hasUnsavedChanges()`/`markSaved()`. Geometry and text updates bump `revision` only on a real change, so a drag pinned at the page edge or an unchanged commit does not count.
- Editing: the frame stays while editing (`editFrameBox`, `EDIT_FRAME_MARGIN = 6`) and encloses the editor's measured `offsetWidth`. Typing re-lays it out through the editor's `resized` callback. While the editor is open, `startDrag` does not cancel pointerdown, and the frame's and editor's (non-input) `mousedown` is cancelled instead, so the input keeps the focus. The editor treats its `frame` option as its own area for the outside-pointerdown and focusout commits. As a fallback, if a grab takes the focus anyway, the focus is restored. The editor's outline was dropped, because the frame now marks it.
- Checked in headless Edge (Chromium) with real CDP mouse events against a throwaway harness: type "Hamburg", drag the frame margin, drag the separator, type "!", press Enter. Focus stayed in the place input, no commit was reported before Enter, and the commit carried "Hamburg!" at the moved position. A saved "München, 18.10.2026" / "Łódź, Ærøskøbing, Zürich" PDF rendered correctly with pdf.js in Edge.
- Loop 2: attempt 1 re-applied unchanged (diff + padded font from the scratchpad), then: `editorArea()` (exported; `editFrameBox` = area + margin); `Drag.startArea` is set when the dragged text's editor is open, and corner scaling / rotation then run `scaleTextBox` / `rotateBox` on it and rebuild the text box with `resizeFromTopLeft` from the area's top-left corner. Move is unchanged. The rotation dblclick returns early at 0° and, while editing, resets about the area center too. "×" has `tabIndex = -1`; the editor's `grabbing` needs `button === 0`; the separator has `touch-action: none`; `dropSavedNotice()` checks `hasUnsavedChanges`. The overlay tests let the stubbed editor width grow with its font size (as the `ch`-sized inputs do), so the frame-corner assertions hold after the re-layout. Every new loop-2 test was checked to fail with its fix reverted. Not re-checked in a real browser in this loop.

## Spec Change Log

- **Loop 1 (2026-10-18)**
  - **Trigger:** all three review layers found the same problem. While editing, the corner and rotation handles sit on the wider edit frame, but the drag maths used the text box. As a result:
    - the grabbed corner ran ahead of the pointer;
    - nw/sw scaling anchored inside the editor;
    - rotation pivoted around the text box's center, not under the knob.
  - **Amended:** Code Map (editor area, the focusable "×", the rotation dblclick), Design Notes (new: editor-area maths for move, scale and rotate), and Tasks (one new task for the drag maths, and robustness, notice and README items folded in from the triage).
  - **Known-bad state avoided:** handles that do not follow the pointer while editing.
  - **KEEP:** everything else in attempt 1 worked and must survive re-derivation. Its full diff is at `C:\Users\matth\AppData\Local\Temp\claude\c--Users-matth-GitCode-ECpdfSign\b4003527-738d-489e-8ad6-2718d4cab682\scratchpad\post-test-fixes-attempt-1.diff`, and the padded font at `...\scratchpad\attempt-1\NotoSans-Regular.ttf`. Reuse both. In particular, keep:
    - the padded font, its README, and the even-length and glyph-outline tests;
    - `revision`/`savedRevision`, `hasUnsavedChanges`/`markSaved`, bumped only on real change, with the app open/save tests for every matrix row;
    - `editFrameBox`/`EDIT_FRAME_MARGIN`, and the frame enclosing the measured editor;
    - the editor's `grab`/`resized`/`{ frame }` API;
    - cancelling `mousedown` (not pointerdown) while editing;
    - focus restore after a grab, and the `.place-date-separator` move cursor;
    - all attempt-1 tests, with their expectations tightened where the new scale and rotate behaviour changes them.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|-------|---------|---------|------------------|
| 1 | Blind, Edge, VerifGap-other | Corner scaling while editing uses the text box, not the frame the handles are drawn on | medium | `startDrag` sets `startBox = boxFromGeometry(element)`, while `layout()` draws the handles on `editFrameBox`. With a 132 px text and a 200 px editor, the se corner overshoots the pointer about 1.5×. bad_spec: the Code Map said "drag updates the text's geometry from boxFromGeometry". |
| 2 | Blind, Edge | Rotation while editing pivots on the text center, not the frame center under the knob | medium | `rotateBox` uses `start.cx/cy` of the text box, while the knob sits at the `editFrameBox` top center. Same root cause as #1. bad_spec. |
| 3 | Blind, Edge | `grabbing` is set by non-left pointerdowns; a lost pointerup blocks Tab commits | low | `onOutsidePointerDown` sets `grabbing = !isInput(target)` for any button. A context menu can swallow pointerup. Trivial fix, folded into the amended tasks. |
| 4 | Edge | Shift+Tab from the place input focuses the frame's "×" `<button>`, so the edit stays open and Enter deletes the text | medium | `removeButton` is a `<button>` in `frame`, which precedes the editor in `frameLayer`. `focusout` ignores targets inside the frame. Folded into the tasks (`tabIndex = -1`). |
| 5 | Blind, Edge | Separator has no `touch-action: none`; pointerdown is no longer prevented while editing | low | `.place-date-separator` has only `cursor: move`. A one-line CSS fix, folded in. |
| 6 | Blind | Insert-then-remove (or move-and-back) after a save still asks | false | The frozen Boundaries say "any element change since the last successful save counts". The behaviour matches the intent. |
| 7 | Blind | Closing the window ignores unsaved changes | medium | Pre-existing: there is no close handler in `main.ts`/`app.ts`, and this diff did not cause it. Deferred. |
| 8 | Blind, Edge | `dropSavedNotice()` hides the "Gespeichert" notice on no-op updates and duplicates the revision logic | low | `updateElement` calls `dropSavedNotice()` whenever `updateElementGeometry` returns true, even without a change. Trivial fix (check `hasUnsavedChanges`), folded in. |
| 9 | Edge | Rotation-handle dblclick at 0° round-trips floats and can bump `revision` | low | The dblclick handler always calls `update` through `boxToGeometry`. Trivial guard, folded in. |
| 10 | Blind | Font marked resolved without the Acrobat check | false | The deferred entry itself names "comparing the embedded subset's glyph outlines with the source font" as a way to settle it, and the new save test does exactly that. Manual viewer checks stay in Verification. |
| 11 | Blind | README claims "nothing else changes", but fontTools may touch `head.modified`, checksums and bboxes | low | The claim is stronger than what was checked. A wording fix, folded in. |
| 12 | Blind | Test gaps: Open-after-open setup, no app-level fontSize test, CIDToGIDMap not asserted | false | The second `open` in that test covers the "nothing placed" row. The model test covers the fontSize bump. The CIDToGIDMap identity is pdf-lib's fixed output, and the outline test fails loudly either way. |
| 13 | Blind | Synchronous refocus inside `focusout` is fragile | maybe-false | Attempt 1 checked it in headless Edge, where focus stayed. To settle it would take a WebView2 or WKWebView manual check. Low at most, so rejected. |
| 14 | VerifGap | No test shows that `grabbing` resets after pointerup/pointercancel, so Tab after a drag could stop committing | low | Pre-verified gap. Test folded into the tasks. |
| 15 | VerifGap | No test shows pointerdown is not cancelled while editing | low | Pre-verified gap. Test folded into the tasks. |
| 16 | Edge | Option doc says the frame "never takes the focus", but Shift+Tab does focus it | medium | Same root cause as #4. Folded in. |
| 17 | Blind (loop 2) | "Gespeichert" is shown although an element changed during the save | low | Real, but older than this spec: `save()` showed the notice the same way before. Not caused by this change and rarely met (the change has to happen during the few ms of a build). Rejected. |
| 18 | Blind, Edge (loop 2) | A zero-delta pointermove's float round trip bumps `revision` (exact `===` in `rectsEqual`) | medium | `onPointerMove` always goes through `boxFromGeometry` → `keepOnPage` → `boxToGeometry`, and `rectsEqual` compares exactly. A simple click with a 0-px move after a save could bring the prompt back. Patch: compare with a tolerance. |
| 19 | Blind (loop 2) | Frame corner drifts if the date input's picker does not scale with the font | maybe-false | The jsdom stub scales linearly. To settle it, scale a text while editing in WebView2. At most a few px of drift, so low. Rejected; noted for the manual check. |
| 20 | Blind (loop 2) | Edit-mode scale/rotate not tested with a rotated text, the ne/sw corners or Shift snapping | low | The drag path reuses `scaleTextBox`/`rotateBox`/`resizeFromTopLeft`, which have their own rotated tests in `geometry.test.ts`. Rejected. |
| 21 | Blind (loop 2) | README lacks SHA-256s and a pinned fontTools version | low | Reproducibility nicety; the outline test guards the shipped file. Rejected. |
| 22 | Blind (loop 2) | Acceptance "opened in Acrobat or Edge" is not met | carried | Same as #10: false. The outline test settles the glyph data. The viewer check stays a manual check, reported to the user. |
| 23 | Blind (loop 2) | Spec KEEP points at session temp paths | false | The fix would be to edit this build's spec, so the triage rules reject it. |
| 24 | Blind (loop 2) | Spec frontmatter stale (status, loop count) | false | Status is `in-review` as step 4 sets it, and `review_loop_iteration: 1` is correct after one loopback. |
| 25 | Blind (loop 2) | "Save not completed" does not test signature-warning "Abbrechen" or a font-load failure | low | Both return before `markSaved`. Adding the two tests is trivial and pins the contract. Patch. |
| 26 | Blind (loop 2) | `revision` doc comment says every mutator bumps it | low | The comment contradicts the "only a real change" rule in the code. Patch (doc). |
| 27 | Blind (loop 2) | Glyph-outline test pairs string index with glyph index | low | All test strings are BMP, one glyph per char, with ligatures off (`TEXT_FEATURES`). Unlikely to bite. Rejected. |
| 28 | Blind (loop 2) | Even-length guard throws an opaque error for CFF/TTC and has a magic glyph count | low | Only matters if the font is swapped, and then the test fails either way. Rejected. |
| 29 | Blind (loop 2) | Frame measured before the web font loads | false | `loadBundledFont()` (`src/placeDate/font.ts:13`) awaits `document.fonts.load('16px "ECpdfSign Text"')` before any text is inserted or edited. |
| 30 | Edge (loop 2) | Enter/Esc during a held edit-mode drag: the drag goes on with a stale `startArea` and writes a box that no longer fits the text | low | Real: `layout()` ends a drag only when the selection changes. A one-line guard (end the drag when its `startArea` editor closed). Patch. |
| 31 | Edge (loop 2) | Tab during a held grab is swallowed | low | Needs Tab pressed while the mouse button is held on the frame. Unlikely, and the fix needs extra state. Rejected. |
| 32 | Edge (loop 2) | Typing while dragging changes the editor width mid-drag | low | Needs typing with the mouse button held. Unlikely. Rejected. |
| 33 | VerifGap (loop 2) | Focus restore after a grab is untested for the date input | low | Filed as defer, but the fallback path is low severity. Rejected with this note: test by focusing `date`, grabbing, blurring, releasing, and expecting `date`. |

## Design Notes

**Editor area while editing.** The editor area is the frame without its margin. It starts at the text box's top-left corner, is `max(editorWidth, box.width)` wide and `box.height` high, and has the box's rotation. The frame is the editor area plus `EDIT_FRAME_MARGIN` on every side, and its handles sit on the frame's corners.

**Move.** The text box gets the same delta. Unchanged.

**Corner scaling.**
1. Run `scaleTextBox` on the editor area, so the opposite corner of the area stays fixed and the scale factor comes from the area.
2. Rebuild the text box from the new area:
   - its top-left is the new area's top-left;
   - its width and height are the old ones times the factor;
   - its font size is the old one times the factor;
   - its rotation is unchanged.

The constant margin means the grabbed frame corner lies `EDIT_FRAME_MARGIN·√2` beyond the area corner. That offset does not change while dragging, so the corner stays under the pointer. The `inputs` are sized in `ch` and scale with the font, so the next layout matches.

**Rotation.**
1. Rotate the editor area around its own center, which is the frame's center under the knob, using `rotateBox`.
2. Rebuild the text box: its top-left is the rotated area's top-left, and its size is unchanged.

**Interaction with other rules.** `keepOnPage` applies to the resulting text box, as with every drag. When the editor is not open, nothing changes: drags work on the text box as before.

## Verification

**Commands:**
- `npm.cmd run build`: expected to succeed.
- `npm.cmd test`: expected all green, including the new glyph-outline test (which fails against the old font file).
- `cargo test` (from `src-tauri/`): expected green (no Rust change expected).

**Manual checks:**
- In the app: place "München, 18.10.2026", save, and reopen the saved PDF in the app and in Edge; the text must read exactly that.
- Save, then click "PDF Öffnen": no question. Move a signature, then click "PDF Öffnen": the question appears.
- Insert a text, type a place, drag the text, press Enter: the text stays at the new spot with the typed place.
