// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { signatureWarning } from "../app";
import { createConfirmDialog } from "./confirmDialog";
import indexHtml from "../../index.html?raw";

beforeEach(() => {
  document.body.replaceChildren();
});

function setup() {
  const dialog = document.createElement("dialog");
  const confirm = document.createElement("button");
  confirm.dataset.value = "confirm";
  confirm.textContent = "Verwerfen";
  const cancel = document.createElement("button");
  cancel.dataset.value = "cancel";
  cancel.textContent = "Abbrechen";
  dialog.append(confirm, cancel);
  document.body.append(dialog);
  return { dialog, confirm, cancel, ask: createConfirmDialog(dialog).ask };
}

describe("confirm dialog", () => {
  it("resolves true on 'Verwerfen' and closes", async () => {
    const { dialog, confirm, ask } = setup();
    const answer = ask();
    expect(dialog.open).toBe(true);
    confirm.click();
    await expect(answer).resolves.toBe(true);
    expect(dialog.open).toBe(false);
  });

  it("resolves false on 'Abbrechen' and focuses it by default", async () => {
    const { cancel, ask } = setup();
    const answer = ask();
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await expect(answer).resolves.toBe(false);
  });

  it("resolves false when closed otherwise (Esc)", async () => {
    const { dialog, ask } = setup();
    const answer = ask();
    dialog.close();
    await expect(answer).resolves.toBe(false);
  });

  it("can be asked again and shares a pending question", async () => {
    const { confirm, cancel, ask } = setup();
    const first = ask();
    expect(ask()).toBe(first);
    cancel.click();
    await expect(first).resolves.toBe(false);
    const second = ask();
    confirm.click();
    await expect(second).resolves.toBe(true);
  });
});

describe("confirm dialog with a text per question", () => {
  function setupWithText() {
    const { dialog, ...rest } = setup();
    const text = document.createElement("p");
    text.className = "confirm-dialog-text";
    text.textContent = "Alt";
    dialog.prepend(text);
    return { dialog, text, ...rest };
  }

  it("shows the given text and keeps it for a shared pending question", async () => {
    const { text, cancel, ask } = setupWithText();
    const first = ask("Frage 1");
    expect(text.textContent).toBe("Frage 1");
    expect(ask("Frage 2")).toBe(first);
    expect(text.textContent).toBe("Frage 1");
    cancel.click();
    await first;
    const second = ask("Frage 2");
    expect(text.textContent).toBe("Frage 2");
    cancel.click();
    await second;
  });

  it("keeps the fixed text when asked without one", async () => {
    const { text, cancel, ask } = setupWithText();
    const answer = ask();
    expect(text.textContent).toBe("Alt");
    cancel.click();
    await answer;
  });

  it("refuses a text if the dialog has no text element", () => {
    const { ask } = setup();
    expect(() => ask("Frage")).toThrow(/text element/);
  });
});

describe("signature warning dialog (index.html)", () => {
  function setupFromIndexHtml() {
    // Only the dialog's markup, so happy-dom does not try to load the stylesheet.
    const markup = /<dialog[^>]*id="signatures-dialog"[\s\S]*?<\/dialog>/.exec(indexHtml);
    expect(markup).not.toBeNull();
    document.body.innerHTML = markup![0];
    const dialog = document.getElementById("signatures-dialog") as HTMLDialogElement;
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-value="confirm"]')!;
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-value="cancel"]')!;
    const text = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    return { dialog, confirm, cancel, text, ask: createConfirmDialog(dialog).ask };
  }

  it("names the number of signatures and offers 'Trotzdem speichern' / 'Abbrechen'", async () => {
    const { dialog, confirm, cancel, text, ask } = setupFromIndexHtml();
    expect(confirm.textContent).toBe("Trotzdem speichern");
    expect(cancel.textContent).toBe("Abbrechen");

    const answer = ask(signatureWarning(2));
    expect(text.textContent).toBe(
      "Dieses PDF enthält 2 digitale Signaturen. Beim Speichern werden sie ungültig.",
    );
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(cancel);
    confirm.click();
    await expect(answer).resolves.toBe(true);
  });

  it("'Abbrechen' and Esc resolve false", async () => {
    const { dialog, cancel, ask } = setupFromIndexHtml();
    const cancelled = ask(signatureWarning(1));
    cancel.click();
    await expect(cancelled).resolves.toBe(false);
    const escaped = ask(signatureWarning(1));
    dialog.close(); // what the browser does on Esc
    await expect(escaped).resolves.toBe(false);
  });
});

describe("signatureWarning", () => {
  it("uses the singular for one signature", () => {
    expect(signatureWarning(1)).toBe(
      "Dieses PDF enthält 1 digitale Signatur. Beim Speichern wird sie ungültig.",
    );
    expect(signatureWarning(3)).toBe(
      "Dieses PDF enthält 3 digitale Signaturen. Beim Speichern werden sie ungültig.",
    );
  });
});
