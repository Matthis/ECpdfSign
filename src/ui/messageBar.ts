// The message bar below the toolbar: German error messages and neutral info
// notices (e.g. "Gespeichert: ..."), one at a time.

export interface MessageBar {
  /** Shows an error (styled as one, announced assertively). */
  show(text: string): void;
  /** Shows a neutral notice (styled as info, announced politely). */
  info(text: string): void;
  hide(): void;
}

/**
 * `bar` contains `text`, where the message goes, and `closeButton`, which
 * hides it. The variant is exposed as `data-kind="error" | "info"` for styling.
 */
export function createMessageBar(
  bar: HTMLElement,
  text: HTMLElement,
  closeButton: HTMLElement,
): MessageBar {
  function showAs(message: string, kind: "error" | "info"): void {
    bar.dataset.kind = kind;
    bar.setAttribute("role", kind === "error" ? "alert" : "status");
    text.textContent = message;
    bar.hidden = false;
  }

  function hide(): void {
    bar.hidden = true;
    text.textContent = "";
  }

  closeButton.addEventListener("click", hide);

  return {
    show: (message) => showAs(message, "error"),
    info: (message) => showAs(message, "info"),
    hide,
  };
}
