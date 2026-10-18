// Inline editor of a place/date text, shown on the page where the text is, in
// its font size and rotation: a text input for the place, ", " and an
// `<input type="date">` for the date.
// - Enter, a pointerdown anywhere outside the editor, or the focus leaving it
//   (Tab) commits.
// - Esc cancels: the text keeps the values it had before this edit.
// - The overlay's frame around the editor (its margin, handles, "×") and the
//   ", " separator are not "outside": grabbing them moves, scales or rotates
//   the text while the edit stays open, with its input and focus.
// The editor only reports; the app decides (and removes a text with both
// parts empty). Entf/Backspace typed into the inputs never reach the element
// shortcuts (see isTextEntry in ./keyboard).

import { ddMmYyyyToIso, isoToDdMmYyyy } from "../placeDate/format";
import { boxPoint, type Box } from "./geometry";

export interface PlaceDateEditorCallbacks {
  /** `date` is DD.MM.YYYY, or empty if the date input was cleared. */
  commit(id: string, place: string, date: string): void;
  cancel(id: string): void;
  /**
   * A left-button pointerdown on the editor outside its inputs (the ", "
   * separator): the overlay starts moving the text.
   */
  grab?(event: PointerEvent): void;
  /** The editor changed its size by itself (the place input grows with the text). */
  resized?(): void;
}

export interface PlaceDateEditorOptions {
  /**
   * The frame the overlay draws around the editor. Pointerdowns on it and
   * focus moving to it do not end the edit. A click on it does not take the
   * focus (its mousedown is cancelled), and nothing in it is reachable by Tab.
   */
  frame?: HTMLElement;
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

export function createPlaceDateEditor(
  callbacks: PlaceDateEditorCallbacks,
  options: PlaceDateEditorOptions = {},
): PlaceDateEditor {
  const { frame } = options;
  let editingId: string | null = null;
  /** The input to give the focus back to if a grab took it anyway. */
  let lastFocused: HTMLInputElement | null = null;
  /** A pointer is down on the frame or the separator (moving, scaling, rotating the text). */
  let grabbing = false;
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
    callbacks.resized?.();
  });
  for (const input of [placeInput, dateInput]) {
    input.addEventListener("focus", () => (lastFocused = input));
  }

  const isInput = (target: EventTarget | null) => target === placeInput || target === dateInput;

  // Clicks inside never deselect (page background); outside the inputs they grab the text.
  root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.button === 0 && !isInput(event.target)) callbacks.grab?.(event);
  });
  root.addEventListener("dblclick", (event) => event.stopPropagation());
  // A click outside the inputs (or on the frame) must not take the focus from
  // them: cancelling pointerdown does not stop that in Chromium, cancelling
  // mousedown does.
  root.addEventListener("mousedown", (event) => {
    if (!isInput(event.target)) event.preventDefault();
  });
  frame?.addEventListener("mousedown", (event) => {
    if (editingId !== null) event.preventDefault();
  });

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

  // Focus moving out of the editor (Tab) ends the edit. Not when the whole
  // window loses focus (the user comes back to the editor), and not while the
  // text is being grabbed.
  root.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && isOwn(event.relatedTarget)) return;
    if (!document.hasFocus()) return;
    if (grabbing) {
      // The grab took the focus after all: give it back, the edit goes on.
      if (event.target instanceof HTMLInputElement) event.target.focus();
      return;
    }
    finish("commit");
  });

  /** Inside the editor or its frame. */
  function isOwn(node: Node): boolean {
    return root.contains(node) || !!frame?.contains(node);
  }

  function onOutsidePointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && isOwn(event.target)) {
      // Only the left button grabs; another button's release may never come
      // (a context menu can swallow it), which would block the Tab commit.
      grabbing = event.button === 0 && !isInput(event.target);
      return;
    }
    finish("commit");
  }

  function onPointerRelease(): void {
    const grabbed = grabbing;
    grabbing = false;
    // Keep typing where the user was, should the grab have taken the focus.
    if (grabbed && editingId !== null && lastFocused && !root.contains(document.activeElement)) {
      lastFocused.focus();
    }
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
    grabbing = false;
    lastFocused = null;
    root.hidden = true;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    document.removeEventListener("pointerup", onPointerRelease, true);
    document.removeEventListener("pointercancel", onPointerRelease, true);
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
      lastFocused = placeInput;
      root.hidden = false;
      // Capture phase: runs before anything the pointerdown starts elsewhere.
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
      document.addEventListener("pointerup", onPointerRelease, true);
      document.addEventListener("pointercancel", onPointerRelease, true);
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
