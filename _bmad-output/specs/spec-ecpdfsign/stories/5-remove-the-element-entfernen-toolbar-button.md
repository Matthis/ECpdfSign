---
title: 'Remove the "Element entfernen" toolbar button'
type: 'refactor'
created: '2026-10-17'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-ecpdfsign/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The toolbar still has five buttons, including "Element entfernen". The spec now has four, because the active frame already has an "×" that removes the element.

**Approach:** Remove the `removeElement` toolbar action and its enabling logic so the toolbar shows exactly "PDF Öffnen", "Ort/Datum einfügen", "PNG Unterschrift einfügen" and "Speichern". Removal keeps working through the frame's "×" and through Entf/Backspace, which still use the same app removal path. Adjust the tests to match (four buttons, no toolbar removal). The overlay's "×" keeps its "Element entfernen" tooltip and aria-label.

</frozen-after-approval>

## Implementation Notes

- `src/ui/toolbar.ts`: dropped the `removeElement` action and button. The doc comment states that removal goes through the frame's "×" and Entf/Backspace.
- `src/app.ts`: dropped the `removeElement` toolbar enabling and dispatch. `removeSelected()` is kept for the Entf/Backspace shortcut, and `removeElement(id)` for the overlay's "×".
- Tests: `toolbar.test.ts` now expects four buttons. `app.test.ts` removes through `handleShortcut("removeElement")` instead of the toolbar action; the type system rules out a toolbar "removeElement" action.
- Review patches:
  - The "×" title now mentions "(Entf)" and has `aria-keyshortcuts`.
  - Tests cover removal blocked while saving (via "×" and Entf) and the Entf shortcut without a document.
  - The toolbar-state test asserts that insert stays enabled.

## Review Triage Log

- low, **patch**: the keyboard shortcut is not discoverable without the button. The "×" title is now "Element entfernen (Entf)" with `aria-keyshortcuts`.
- low, **patch**: no test that "×" and Entf are blocked while saving (guarded by `editable()`). Test added.
- low, **patch**: no test for Entf without a document. Test added.
- low, **patch**: the rewritten toolbar-state test only asserted what the type system guarantees. It now asserts the insert enabling.
- low, rejected: the "×" can sit under the toolbar or strip when a signature hangs over the page's top or left edge. Only happens with overhang; the user can drag the signature back or press Entf. Repositioning the "×" adds layout code.
- false: the "×" gives no feedback while removal is blocked. While the warning is open, the modal dialog makes the page inert, and the native file dialogs are modal. During the millisecond-long build/load, `removeElement` is a guarded no-op.
- false: story file "incomplete". Oneshot specs carry only Intent and Implementation Notes by design.
- false: tracking not updated. Status is set to done on finalize; `done_checkpoint` is a dispatch flag, not a status.
- rejected: the `main.ts` wiring of "×" → `app.removeElement` is untested. Already covered by the deferred `main.ts` wiring item from story 2.
