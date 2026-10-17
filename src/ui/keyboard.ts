// Keyboard shortcuts for placed elements: Entf/Backspace removes the selected
// element, Esc deselects it. Never while the user is typing into a text field
// or while a dialog has the focus.

export type Shortcut = "removeElement" | "deselect";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether keys typed at `target` edit text (inputs, textareas, contenteditable). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return false;
}

export function shortcutFor(event: KeyboardEvent): Shortcut | null {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return null;
  if (isTextEntry(event.target)) return null;
  if (event.target instanceof Element && event.target.closest("dialog")) return null;
  switch (event.key) {
    case "Delete":
    case "Backspace":
      return "removeElement";
    case "Escape":
      return "deselect";
    default:
      return null;
  }
}
