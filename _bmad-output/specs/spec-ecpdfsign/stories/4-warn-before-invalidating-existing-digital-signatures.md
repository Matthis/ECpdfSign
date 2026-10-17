---
title: 'Warn before invalidating existing digital signatures'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd0ddfcdc368bb8d24aab681b706c30971eec4bcc'
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Saving rewrites the whole PDF with pdf-lib. Any digital signature already in the document (a signed `/Sig` field) becomes invalid, and today the user gets no warning.

**Approach:** When a PDF is opened, count its signed signature fields. Before saving such a PDF, before the file is built or the save dialog opens, show an in-app warning with "Abbrechen" and "Trotzdem speichern". Unsigned PDFs save exactly as before (SPEC CAP-7).

## Boundaries & Constraints

**Always:**
- A field counts as "signed" when its field type is `/Sig` (also inherited from a parent field) and it has a `/V` value. Fields in `/Kids` are walked recursively, with a guard against reference cycles.
- Detection runs once at open, on the pdf-lib copy that `src/pdf/document.ts` already loads, and is stored with the document. Saving does not parse the document again for this.
- If detection itself throws (malformed AcroForm), opening still succeeds, the count is 0, and the error is logged.
- The warning is a native `<dialog>` like the discard question (`createConfirmDialog`). Its German text names the number of signatures, e.g. "Dieses PDF enthält 2 digitale Signaturen. Beim Speichern werden sie ungültig." (singular for 1). The buttons are "Trotzdem speichern" and "Abbrechen", with focus on "Abbrechen", and Esc counts as "Abbrechen".
- "Abbrechen" writes nothing, builds nothing, shows no save dialog and no message. The placements stay.
- Decision: the warning appears once per opened document. After "Trotzdem speichern" has been chosen, later saves of that document don't ask again, even if that save is then cancelled or fails. After "Abbrechen", the next save asks again. Opening a document (the same file again or another) resets this.
- Decision: right after a signed PDF is opened, the message bar shows the info notice "Dieses PDF ist digital signiert. Beim Speichern werden die Signaturen ungültig." The notice follows the existing info behaviour: it is replaced by other messages and closed with ×. An unsigned PDF shows no notice.

**Never:**
- No incremental (append-only) save that would preserve the signatures.
- No signature validation or certificate display.
- No warning for unsigned (empty) signature fields.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed PDF, continue | PDF with 1 signed `/Sig` field, signatures placed, "Speichern" → "Trotzdem speichern" | Normal save flow (build → save dialog) | N/A |
| Signed PDF, cancel | Same, "Abbrechen" or Esc | Nothing built, no save dialog, no message, placements kept | N/A |
| Unsigned PDF | No signed `/Sig` fields | Save without a warning | N/A |
| Empty signature field | `/Sig` field without `/V` | Counts as unsigned: no warning | N/A |
| Nested field | Signed `/Sig` widget in a parent's `/Kids`, `/FT` inherited from the parent | Detected (count 1) | N/A |
| Several signatures | 2 signed fields | Warning text says "2 digitale Signaturen" | N/A |
| Second save | Signed PDF, "Trotzdem speichern" chosen once, user saves again | No second warning; normal save flow | N/A |
| Ask again after cancel | Signed PDF, "Abbrechen" chosen, user saves again | Warning appears again | N/A |
| Reopen | After "Trotzdem speichern", the user opens a signed PDF (same or other) | The next save warns again | N/A |
| Open notice | Signed PDF opened | Info notice "Dieses PDF ist digital signiert. Beim Speichern werden die Signaturen ungültig." | N/A |
| Open unsigned | Unsigned PDF opened | No notice | N/A |
| Malformed AcroForm | `/Fields` is not an array, a reference cycle, or a broken reference | PDF opens; count 0; no crash | Error logged, no message |

</frozen-after-approval>

## Code Map

- `src/pdf/document.ts` -- `checkWithPdfLib(bytes)` loads the pdf-lib copy at open (returns `{status, pageCount}`); `loadPdfDocument` returns `LoadedPdf`. Extend the result with `signedSignatureCount`.
- `src/pdf/` (new `signatures.ts` or inside document.ts) -- pure low-level traversal of `catalog /AcroForm /Fields` via pdf-lib objects (`PDFDict`, `PDFArray`, `PDFName`, `PDFRef`, `context.lookup`). Do not use `doc.getForm()`, which throws or normalizes on unusual forms.
- `src/model.ts` -- `DocumentState`; store `signedSignatureCount` (set at open).
- `src/app.ts` -- `save()`: the guard (`editable`, `inserting`, element count), then build and `savePdf`. Insert the warning before `buildSignedPdf`. Also `AppDeps` (add `confirmInvalidateSignatures(count): Promise<boolean>`), `MESSAGES`, and the `messages` wrapper (info vs. error).
- `src/ui/confirmDialog.ts` -- `createConfirmDialog(dialog)`; a fixed text today. The warning needs a text set per call (count), so extend `ask()` to take an optional text, or create a second dialog whose text node is set before `ask`.
- `index.html` -- `#discard-dialog` markup is the pattern for a second dialog `#signatures-dialog`.
- `src/main.ts` -- wiring of dialogs into `createApp`.
- Tests: `src/pdf/document.test.ts` builds PDFs with pdf-lib, so signed fields can be created there with low-level `context.obj` (`/FT /Sig`, `/V` dict). Use `app.test.ts` fakes for the flow and happy-dom for the dialog.

## Tasks & Acceptance

**Execution:**
- [x] `src/pdf/signatures.ts` (new, + test) -- `countSignedSignatureFields(doc: PDFDocument): number` per the "signed" rule; recursive over `/Kids` with cycle guard; never throws (returns 0 and lets the caller log) -- pure detection.
- [x] `src/pdf/document.ts` (+ test) -- compute the count in the pdf-lib check and expose `LoadedPdf.signedSignatureCount` -- detect once at open.
- [x] `src/model.ts`, `src/app.ts` (+ `app.test.ts`) -- store the count; in `save()`, ask before building when count > 0 and not yet confirmed for this document; info notice after opening a signed PDF -- the flow.
- [x] `src/ui/confirmDialog.ts` (+ test), `index.html`, `src/main.ts` -- dialog with per-call text, "Trotzdem speichern" / "Abbrechen", focus on "Abbrechen" -- UI.
- [x] Tests cover every I/O matrix row.

**Acceptance Criteria:**
- Given a PDF signed with a real `/Sig` + `/V` structure, when the user saves and chooses "Abbrechen", then `buildSignedPdf` and `savePdf` are never called.
- Given an unsigned PDF, when saving, then no warning dialog is shown and the flow is unchanged from story 3.

## Implementation Notes

- Detection is in `src/pdf/signatures.ts` (`countSignedSignatureFields`). It is iterative with a visited set and never throws. Broken parts are skipped and reported. A signed field next to broken entries still counts, so a partly broken form still warns.
- `document.ts` logs detection problems via `console.error` (it has no access to `deps.log`).
- `DocumentState` has `signedSignatureCount` and `signatureWarningAccepted`. The latter is set by "Trotzdem speichern" and reset by any open.
- `ConfirmDialog.ask(text?)` sets `.confirm-dialog-text` per call. `#signatures-dialog` is in `index.html`.
- The message helper has a separate `saved()` call, so only "Gespeichert" is hidden on element changes and the open notice is not.
- Not tried with a real Acrobat-signed PDF (manual check pending).

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | edge, blind | Elements are snapshotted before awaiting the warning, so the comment "saved as they are now" is wrong and cancel does wasted work | low | No geometry can change meanwhile, because the modal `<dialog>` makes the page inert and shortcuts are blocked; still a direct reorder. **patch** |
| 2 | verif-gap | Nothing pins that the busy cursor stays off while the warning is open or after "Abbrechen" | medium | Pre-verified. **patch** (test only) |
| 3 | blind | A field reached twice is always logged as a "reference cycle", though duplicates in `/Fields`/`/Kids` are common and harmless | low | `signatures.ts` problem text; direct correction. **patch** |
| 4 | blind | "Not asked again even if that save fails" is untested for a `buildSignedPdf` failure | low | Only cancel and `savePdf` rejection are covered; test only. **patch** |
| 5 | verif-gap | `main.ts` wiring of `#signatures-dialog` with `signatureWarning(count)` untested | medium | Pre-verified; `main.ts` has no harness (same as the story 2 deferred item). **defer** |
| 6 | blind | Signatures only referenced from catalog `/Perms` (UR3 usage rights) are not detected | low | Outside the approved "signed field" rule; affects Reader-extended features, not a visible signature. Rejected (reported to the user) |
| 7 | blind | An explicit `/FT null` blocks `/Sig` inheritance | low | Needs a deliberately odd PDF. Rejected |
| 8 | blind | No cap on logged problems for hostile PDFs | low | Console noise only; aggregation adds code. Rejected |
| 9 | blind | `document.ts` logs via global `console.error`, not `deps.log` | low | Design nit with no user harm. Rejected |
| 10 | blind | Stale "story 5" references for place/date after the renumbering | — | Spec text; SPEC.md was fixed outside this triage; the done story 3 spec stays historical. Rejected |
| 11 | blind | Spec renegotiation (4 buttons) is in this diff while the code still has 5 | — | Deliberate: implemented by the new story 5; the spec change is committed separately. Rejected |
| 12 | blind | The malformed-AcroForm row says count 0, but mixed broken+signed counts 1, untested | false | Matrix inputs contain no signed field (count 0 holds); the mixed case is tested ("counts a signed field inside a reference cycle once"). |
| 13 | blind | `signedSignatureCount` duplicated on `LoadedPdf` and `DocumentState`, not validated | low | The value comes only from the detector, which returns non-negative integers. Rejected |
| 14 | blind | Esc tested via `dialog.close()` instead of a real cancel event | low | happy-dom limitation; the real Esc path is the native dialog's. Rejected |
| 15 | edge, blind | `showModal()` throwing or a missing text element leave `ask()` broken or throwing synchronously | false | Unreachable: static markup in `index.html`, and the `pending` guard prevents a second open. |
| 16 | blind | The dialog should be `alertdialog` with a short title | low | Accessibility polish. Rejected |
| 17 | blind | Story review sections empty | — | Fix edits the spec. Rejected |

## Verification

**Commands:**
- `npm run build` -- expected: tsc and vite build succeed.
- `npm test` -- expected: all vitest tests pass.
- `cargo clippy --all-targets` and `cargo test` (in `src-tauri/`) -- expected: unchanged, pass.

**Manual checks:**
- `npm run tauri dev`, with a digitally signed PDF (e.g. one signed in Acrobat):
  - The warning appears when saving.
  - "Abbrechen" does nothing.
  - "Trotzdem speichern" saves.
  - In Acrobat, the saved file shows the signature as invalid.
