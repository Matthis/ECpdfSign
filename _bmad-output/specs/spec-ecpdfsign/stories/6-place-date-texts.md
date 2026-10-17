---
title: 'Place/date texts'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '098d9764673c531e159a82190c8e8806f24ee852'
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** "Ort/Datum einfügen" is still disabled. Users cannot add the usual "München, 17.10.2026" line next to their signature.

**Approach:**
- "Ort/Datum einfügen" adds a text element "<place>, <date>". The date is prefilled with today; either part may be empty.
- The text is placed like a signature, with the same active frame and "×". By default it sits beside or below the selected signature, or centered when there is none.
- Corner handles change the font size; the glyphs are never stretched.
- The text is saved with a bundled, embedded Unicode font, so preview and PDF look the same (SPEC CAP-4).

## Boundaries & Constraints

**Always:**
- Text format:
  - Both parts given: "<place>, <date>".
  - Only one given: just that part, with no comma.
  - Both empty: the element is not created (on insert) or is removed (on edit).
- The date is formatted DD.MM.YYYY and prefilled with today's local date.
- Font: one bundled OFL-licensed Unicode sans font (e.g. Noto Sans Regular) shipped in the app bundle.
  - The preview uses it via a same-origin `@font-face`. The PDF embeds a subset of it via `@pdf-lib/fontkit`.
  - No system or remote fonts.
  - The text is black.
  - Place names such as "Łódź", "Ærøskøbing" and "Zürich" render in both the preview and the PDF.
- Model:
  - The `placeDate` element stores `place`, `date`, `fontSize` (PDF points) and `rotation`.
  - Its `rect` is the unrotated text box in PDF user space, derived from the font metrics (advance width × ascent−descent at `fontSize`), never typed in by the user.
  - A newly inserted text uses 11 pt.
- Frame:
  - Corner handles scale the font size, keeping the corner opposite the dragged handle fixed.
  - Edge handles are not shown for texts.
  - Minimum font size is 6 pt.
- Default position:
  - With a selected signature on the current page: below it, left-aligned with it, with a small gap.
  - If that does not fit on the page: to its right, vertically centered.
  - Without a selected signature: centered on the page.
  - The new text becomes the selected element.
- Saving draws the text with the same corner-matrix approach as signatures (story 3), so position, size and rotation match the preview. pdf.js `getTextContent` on the saved PDF returns the exact string.
- The SPEC "WYSIWYG" and "fully local" constraints apply. The font file is the only new asset, and it is served under `'self'`.
- Decision (input): editing happens in place on the page, with no dialog.
  - After "Ort/Datum einfügen" the new element is immediately in edit mode. The empty place input has focus, followed by ", " and the date input.
  - Edit mode shows inline inputs in the element's position, font size and rotation.
  - Enter or a pointerdown outside the element commits. Esc reverts to the values from before this edit. For a fresh insert those are an empty place and today, i.e. "<today>".
  - A double-click on a text element enters edit mode again.
  - While editing, Entf/Backspace edit the text and never remove the element. The existing text-input guard in `ui/keyboard.ts` handles this.
  - If both parts are empty when committing, the element is removed.
- Decision (date): the date part is an `<input type="date">` (calendar picker), prefilled with today. It is stored and shown as DD.MM.YYYY, and it can be cleared.
- Decision (rotation): texts get the same rotation handle as signatures (snap at 0/90/180/270 within ±3°, Shift = 15° steps, double-click on the handle = 0°). Defaults to 0°.
- Decision (place memory): the place is not remembered. The place input starts empty on every insert.

**Never:**
- No bold, italic, colour or font choice.
- No multi-line text.
- No free text other than place and date.
- No system font fallback in the PDF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Insert below signature | Signature selected on page 2, user types "München" in the inline place input, Enter | "München, 17.10.2026" (today) below the signature, selected | N/A |
| Escape on insert | Fresh insert, user types "Mü", Esc | Text shows "<today>" (place empty) | N/A |
| Re-edit | Double-click on "München, 17.10.2026", change place to "Berlin", click outside | "Berlin, 17.10.2026" | N/A |
| Date picker | User picks 01.11.2026 in the calendar | "München, 01.11.2026" | N/A |
| Typing Entf while editing | Edit mode, Entf/Backspace in an input | Edits the text; the element stays | N/A |
| Rotate | Rotation handle on a text | Rotates like a signature; editing a rotated text shows the inputs rotated the same way | N/A |
| Insert without signature | No signature selected | Text centered on the current page | N/A |
| No room below | Selected signature at the bottom edge | Text placed to the right of the signature | N/A |
| Only date | Place empty | "17.10.2026" (no comma) | N/A |
| Only place | Date cleared | "München" | N/A |
| Both empty | Place empty and date cleared, then commit | The element is removed | N/A |
| Unicode | Place "Łódź" | Same glyphs in preview and saved PDF; `getTextContent` returns "Łódź, …" | N/A |
| Resize | Corner handle dragged | Font size changes, aspect ratio kept, opposite corner fixed, never below 6 pt | N/A |
| Remove | "×" or Entf on a selected text | Removed | N/A |
| Save | Texts on rotated pages (/Rotate 90) and rotated by 30° | Saved position, size and rotation match the preview (≤ 0.01 px at the box corners) | N/A |
| No document | No PDF open | "Ort/Datum einfügen" disabled | N/A |

</frozen-after-approval>

## Code Map

- `src/model.ts` -- `PlaceDateElement` (declared, unused); extend it with `place`, `date`, `fontSize`. `addSignature`/`removeElement`/`updateElementGeometry` are the pattern; add `addPlaceDate` and `updatePlaceDateText`.
- `src/ui/overlay.ts` -- signature-only today (`element.kind === "signature"` guards at ~183, ~235). Generalize to render text elements (a DOM text span in the same font, scaled from `fontSize` via the viewport scale) with the frame: corners only, rotation per decision, and "×".
- `src/ui/geometry.ts` -- `resizeBox`, `defaultPlacement`, `boxToGeometry`/`boxFromGeometry`. Add corner-only font scaling and the beside/below placement next to a signature box.
- `src/app.ts` -- `insertPlaceDate` toolbar action not handled yet. Mirror `insertSignature` (guards `editable()`, `inserting`, `refreshToolbar`, messages). Add the edit flow.
- `src/pdf/save.ts` -- `buildSignedPdf` throws for `placeDate`. Embed the font once (`registerFontkit`, `embedFont(bytes, { subset: true })`), then draw text inside `q` + corner-matrix `cm`, with the baseline offset from the font descent.
- `src/pdf/save.test.ts` -- round-trip harness (pdf.js operator list, corner checks). Extend it with text items via `getTextContent` transforms.
- `src/ui/keyboard.ts` -- `isTextEntry` already makes Entf/Backspace/Esc shortcuts ignore focused inputs; the inline editor relies on it.
- `vite.config.ts`, `tauri.conf.json` -- `font-src 'self' data:` already allows a same-origin font. Bundle the TTF under `src/assets/fonts/` with its OFL license text.
- `package.json` -- add `@pdf-lib/fontkit`.

## Tasks & Acceptance

**Execution:**
- [x] `src/assets/fonts/` -- add the font TTF and its OFL license. Add the `@font-face` in `src/styles.css`. Add `@pdf-lib/fontkit` -- one font for preview and PDF.
- [x] `src/placeDate/format.ts` (new, + test) -- `formatPlaceDate(place, date)` and `todayDdMmYyyy(now)` -- pure text rules.
- [x] `src/placeDate/metrics.ts` (new, + test) -- text box size from fontkit metrics (shared by preview layout and save) -- one source of truth for the box.
- [x] `src/model.ts` (+ test) -- `placeDate` fields, plus add/update/remove -- state.
- [x] `src/ui/geometry.ts` (+ test) -- corner-only font scaling with a 6 pt minimum, and the placement relative to a signature -- pure maths.
- [x] `src/ui/overlay.ts` (+ happy-dom test) -- render and interact with texts (frame, corners, rotation handle, "×", double-click → edit mode).
- [x] `src/ui/placeDateEditor.ts` (new, + happy-dom test), `src/main.ts` -- inline editor (place text input + `<input type="date">`), with commit on Enter or outside pointerdown, revert on Esc, and removal when both parts are empty.
- [x] `src/app.ts` (+ `app.test.ts`) -- insert (straight into edit mode), edit and remove flow, and toolbar enabling.
- [x] `src/pdf/save.ts` (+ `save.test.ts`) -- embed the font once and draw the texts. Round-trip tests cover the corners (≤ 0.01 px) and `getTextContent` strings, including "Łódź" and /Rotate 90 + 30°.

**Acceptance Criteria:**
- Given a selected signature, when "Ort/Datum einfügen" is confirmed with "München", then "München, <today>" appears below the signature, selected, in the bundled font.
- Given texts and signatures on several pages, when saved, then every text appears in the PDF at the preview's corners and pdf.js extracts the same strings.
- Given the built app, when texts are shown and saved, then no CSP violation or network request occurs.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | blind, edge | Tab/focus leaving the inline editor neither commits nor closes it. `editingElementId` stays set, shortcuts are dead, a keyboard page change drops the typed text, and a keyboard save could snapshot stale values | medium | `placeDateEditor.ts` ends only on Enter, Esc or outside pointerdown; no `focusout`. **patch** (commit on focusout leaving the editor) |
| 2 | blind, edge | A half-entered date (one segment cleared) gives `value === ""` and is treated as "date cleared"; with an empty place the element is deleted | medium | `finish` maps `""` to a cleared date with no `validity.badInput` check. **patch** (keep the previous date when the input is bad) |
| 3 | blind, edge | A longer text after re-editing grows past the page edge (no `keepOnPage` after `resizeFromTopLeft`) | low | Direct correction, same rule as dragging. **patch** |
| 4 | blind | Decomposed (NFD) input is shaped by the browser but laid out by advances only in the PDF | low | Direct correction: `normalize("NFC")` on commit. **patch** |
| 5 | edge | Double-click on a text while an insert awaits font or viewport overwrites `editingElementId` and loses the first edit; a page switch during that await opens the editor on a hidden page | low | Missing `inserting` and page re-check guards; direct. **patch** |
| 6 | blind | A font load failure during save shows the generic build error instead of `fontFailed` | low | Direct correction of the catch. **patch** |
| 7 | blind | OFL license text not shipped in the build output | medium | `OFL.txt` is never imported or copied, so `dist/` lacks it; the OFL wants the license to accompany redistributed copies. **patch** (ship it, e.g. via `public/`) |
| 8 | blind | CSS `ascent-override`/`descent-override` hard-code values that `createFontMetrics` reads from the font | low | A font swap would silently break the baseline match; a test is direct. **patch** |
| 9 | verif-gap | "Ort/Datum einfügen" guards (saving, opening, a concurrent insert) untested | medium | Pre-verified. **patch** (tests) |
| 10 | verif-gap | Signature edge handles' visibility (also after a text was selected) unasserted | medium | Pre-verified; shared handle nodes now toggle `hidden`. **patch** (test) |
| 11 | verif-gap | "Centered when the selection is a text" untested | medium | Pre-verified. **patch** (test) |
| 12 | blind | pdf-lib/fontkit subsetting of composite glyphs (Noto accents) is never checked; `getTextContent` only proves ToUnicode | maybe-false (medium if true) | Needs a visual check in Acrobat/Edge or an outline comparison of the embedded subset. **defer** |
| 13 | blind, edge | Characters missing from Noto Sans (CJK, emoji) fall back to a system font in the preview but render `.notdef` in the PDF | low | Real WYSIWYG gap, but unlikely for place names; rejecting or stripping needs a new UX rule. Rejected (reported to the user) |
| 14 | blind | The date picker shows the OS locale format in edit mode (e.g. 10/17/2026 on English Windows) | low | Native control behaviour; the committed text is DD.MM.YYYY. Rejected |
| 15 | blind, edge | Default placement can overlap: no room below or right clamps onto the signature; repeated centered inserts stack | low | Follows the approved rule (below → right → centered). Rejected |
| 16 | blind | Font parsed again on every save | low | Performance only (~430 KB parse). Rejected |
| 17 | blind | Re-editing needs a mouse (no Enter/F2), no accessible name on texts | low | Accessibility polish. Rejected |
| 18 | blind | Editor inputs become tiny at 6 pt or low zoom | low | Cosmetic at extremes. Rejected |
| 19 | blind | SPEC CAP-4 success criteria and the story Code Map not updated | — | Spec text; SPEC updated separately, story spec edit rejected. Rejected |
| 20 | edge | A page render failure while editing leaves `editingElementId` set | low | Needs a render failure mid-edit. Rejected |
| 21 | edge | `document.fonts.load` resolving with no faces silently uses a fallback | low | Both fonts load from the same file, so a fetch failure already surfaces as `fontFailed`. Rejected |
| 22 | edge | Unbalanced q with leftover text-state parameters affects the saved text | low | Needs malformed source content (same as story 3 #19). Rejected |
| 23 | edge | A commit while saving or opening mutates the model after the snapshot | low | The only path is focus leaving the editor, closed by #1. Grouped with #1 |
| 24 | edge | The place input scrolls with wide glyphs (`ch` sizing) | low | Cosmetic while typing. Rejected |
| 25 | edge | `keepOnPage` during corner scaling near the edge moves the anchored corner | low | Same accepted trade-off as story 2 #11. Rejected |

## Design Notes

To draw text at the preview position, compute the box corners exactly as for images (`boxCorners(boxFromGeometry(vp, el))` → `toPdfPoint`). The box's local unit is points at `fontSize`. Use the matrix `[(se−sw)/w, (nw−sw)/h, sw]`, where `w`×`h` is the unrotated box in points. Then, inside `q … Q`, draw the text at x = 0, y = −descent, so the box bottom equals the descender line. The preview places the span the same way: box top = ascent, line-height = ascent − descent.

## Verification

**Commands:**
- `npm run build` -- expected: tsc and vite build succeed.
- `npm test` -- expected: all vitest tests pass.
- `cargo clippy --all-targets` and `cargo test` (in `src-tauri/`) -- expected: pass.

**Manual checks:**
- `npm run tauri dev`, then:
  - insert a text below a signature and one with "Łódź";
  - resize and rotate them, then save;
  - compare the saved file with the preview in Acrobat/Edge;
  - check that copying the text out of the saved PDF gives the same string.
