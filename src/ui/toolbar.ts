export type ToolbarAction =
  | "open"
  | "insertPlaceDate"
  | "insertSignature"
  | "save";

/**
 * The four toolbar buttons, in display order. There is no remove button:
 * elements are removed via the "×" on their frame or with Entf/Backspace.
 */
export const TOOLBAR_BUTTONS: ReadonlyArray<{ action: ToolbarAction; label: string }> = [
  { action: "open", label: "PDF Öffnen" },
  { action: "insertPlaceDate", label: "Ort/Datum einfügen" },
  { action: "insertSignature", label: "PNG Unterschrift einfügen" },
  { action: "save", label: "Speichern" },
];

export interface Toolbar {
  setEnabled(action: ToolbarAction, enabled: boolean): void;
  /** Shows the name of the open document next to the buttons. */
  setDocumentName(name: string | null): void;
}

export function createToolbar(
  container: HTMLElement,
  onAction: (action: ToolbarAction) => void,
): Toolbar {
  const buttons = new Map<ToolbarAction, HTMLButtonElement>();
  for (const { action, label } of TOOLBAR_BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toolbar-button";
    button.textContent = label;
    button.dataset.action = action;
    // Everything but opening needs a document; the app enables buttons as they become usable.
    button.disabled = action !== "open";
    button.addEventListener("click", () => onAction(action));
    buttons.set(action, button);
    container.append(button);
  }

  const docName = document.createElement("span");
  docName.className = "toolbar-docname";
  container.append(docName);

  return {
    setEnabled(action, enabled) {
      const button = buttons.get(action);
      if (button) button.disabled = !enabled;
    },
    setDocumentName(name) {
      docName.textContent = name ?? "";
      docName.title = name ?? "";
    },
  };
}
