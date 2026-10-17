// Inline editor of a place/date text, shown on the page where the text is, in
// its font size and rotation: a text input for the place, ", " and an
// `<input type="date">` for the date.
// - Enter, a pointerdown anywhere outside the editor, or the focus leaving it
//   (Tab) commits.
// - Esc cancels: the text keeps the values it had before this edit.
// The editor only reports; the app decides (and removes a text with both
// parts empty). Entf/Backspace typed into the inputs never reach the element
// shortcuts (see isTextEntry in ./keyboard).

import { ddMmYyyyToIso, isoToDdMmYyyy } from "../placeDate/format";
import { boxPoint, type Box } from "./geometry";

export interface PlaceDateEditorCallbacks {
  /** `date` is DD.MM.YYYY, or empty if the date input was cleared. */
  commit(id: string, place: string, date: string): void;
  cancel(id: string): void;
}

export interface PlaceDateEditor {
  /** The editor's root; the overlay puts it into its (unclipped) frame layer. */
  readonly element: HTMLElement;
  /** Id of the text being edited, or `null` while closed. */
  readonly editingId: string | null;
  /** Opens for a text with its current parts (`date` as DD.MM.YYYY) and focuses the place input. */
  open(id: string, place: string, date: string): void;
  /** Lays the editor over `box` (viewport px), with the text's font size in px. */
  position(box: Box, fontPx: number): void;
  /** Closes without reporting anything. */
  close(): void;
}

/** Width of the place input for `value`, so it grows with the text. */
function placeWidth(value: string): string {
  return `${Math.max(value.length, 3) + 1}ch`;
}

export function createPlaceDateEditor(callbacks: PlaceDateEditorCallbacks): PlaceDateEditor {
  let editingId: string | null = null;
  /** The date when the editor opened (DD.MM.YYYY or empty), kept if the input is left half-filled. */
  let openedDate = "";

  const root = document.createElement("div");
  root.className = "place-date-editor";
  root.hidden = true;

  const placeInput = document.createElement("input");
  placeInput.type = "text";
  placeInput.className = "place-date-place";
  placeInput.placeholder = "Ort";
  placeInput.setAttribute("aria-label", "Ort");
  placeInput.autocomplete = "off";
  placeInput.spellcheck = false;

  const separator = document.createElement("span");
  separator.className = "place-date-separator";
  separator.textContent = ", ";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "place-date-date";
  dateInput.setAttribute("aria-label", "Datum");

  root.append(placeInput, separator, dateInput);

  placeInput.addEventListener("input", () => {
    placeInput.style.width = placeWidth(placeInput.value);
  });

  // Clicks inside neither deselect (page background) nor move the element.
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("dblclick", (event) => event.stopPropagation());

  root.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish("commit");
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish("cancel");
    }
  });

  // Focus moving out of the editor (Tab, a click on the separator) ends the edit.
  // Not when the whole window loses focus: the user comes back to the editor.
  root.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
    if (!document.hasFocus()) return;
    finish("commit");
  });

  function onOutsidePointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && root.contains(event.target)) return;
    finish("commit");
  }

  function finish(kind: "commit" | "cancel"): void {
    const id = editingId;
    if (id === null) return;
    const place = placeInput.value;
    // A half-entered date reads as "" too; only a really cleared input clears the date.
    const date = dateInput.validity.badInput ? openedDate : isoToDdMmYyyy(dateInput.value);
    // Closed first, so the app's redraw does not see a stale editor.
    close();
    if (kind === "commit") callbacks.commit(id, place, date);
    else callbacks.cancel(id);
  }

  function close(): void {
    if (editingId === null) return;
    editingId = null;
    root.hidden = true;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    // Hand the keyboard back to the page, so Entf/Esc work on elements again.
    if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  return {
    element: root,
    get editingId() {
      return editingId;
    },
    open(id, place, date) {
      if (editingId !== null) close();
      editingId = id;
      openedDate = date;
      placeInput.value = place;
      placeInput.style.width = placeWidth(place);
      dateInput.value = ddMmYyyyToIso(date);
      root.hidden = false;
      // Capture phase: runs before anything the pointerdown starts elsewhere.
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
      placeInput.focus();
    },
    position(box, fontPx) {
      const topLeft = boxPoint(box, -box.width / 2, -box.height / 2);
      root.style.left = `${topLeft.x}px`;
      root.style.top = `${topLeft.y}px`;
      root.style.height = `${box.height}px`;
      root.style.fontSize = `${fontPx}px`;
      root.style.lineHeight = `${box.height}px`;
      root.style.transform = box.rotation ? `rotate(${box.rotation}deg)` : "";
    },
    close,
  };
}
