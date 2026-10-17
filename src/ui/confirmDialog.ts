// In-app yes/no question on a native <dialog> (never window.confirm, which
// Tauri's webviews do not show reliably and which blocks the event loop).

export interface ConfirmDialog {
  /** Shows the dialog modally; resolves `true` only if the user confirmed. Esc counts as cancel. */
  ask(): Promise<boolean>;
}

/**
 * `dialog` must contain a `[data-value="confirm"]` and a `[data-value="cancel"]`
 * button. No <form method="dialog"> is used, so the CSP's form-action 'none'
 * cannot interfere.
 */
export function createConfirmDialog(dialog: HTMLDialogElement): ConfirmDialog {
  const confirmButton = dialog.querySelector<HTMLButtonElement>('[data-value="confirm"]');
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-value="cancel"]');
  if (!confirmButton || !cancelButton) throw new Error("confirm dialog buttons missing");
  confirmButton.addEventListener("click", () => dialog.close("confirm"));
  cancelButton.addEventListener("click", () => dialog.close("cancel"));

  let pending: Promise<boolean> | null = null;

  return {
    ask() {
      if (pending) return pending;
      pending = new Promise<boolean>((resolve) => {
        dialog.returnValue = "";
        dialog.addEventListener(
          "close",
          () => {
            pending = null;
            resolve(dialog.returnValue === "confirm");
          },
          { once: true },
        );
        dialog.showModal();
        // The safe choice has the focus, so Enter does not discard by accident.
        cancelButton.focus();
      });
      return pending;
    },
  };
}
