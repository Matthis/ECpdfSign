// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createConfirmDialog } from "./confirmDialog";

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
