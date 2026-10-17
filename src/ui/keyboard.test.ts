// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { isTextEntry, shortcutFor } from "./keyboard";

beforeEach(() => {
  document.body.replaceChildren();
});

function keydown(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  let seen: KeyboardEvent | undefined;
  document.addEventListener("keydown", (e) => (seen = e), { once: true });
  target.dispatchEvent(event);
  return seen!;
}

describe("keyboard shortcuts", () => {
  it("maps Entf/Backspace to remove and Esc to deselect", () => {
    expect(shortcutFor(keydown(document.body, "Delete"))).toBe("removeElement");
    expect(shortcutFor(keydown(document.body, "Backspace"))).toBe("removeElement");
    expect(shortcutFor(keydown(document.body, "Escape"))).toBe("deselect");
    expect(shortcutFor(keydown(document.body, "a"))).toBeNull();
  });

  it("works while a toolbar button has the focus", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(shortcutFor(keydown(button, "Delete"))).toBe("removeElement");
  });

  it("ignores keys typed into text fields", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, textarea, editable);
    for (const target of [input, textarea]) {
      expect(isTextEntry(target)).toBe(true);
      expect(shortcutFor(keydown(target, "Backspace"))).toBeNull();
      expect(shortcutFor(keydown(target, "Escape"))).toBeNull();
    }
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTextEntry(checkbox)).toBe(false);
  });

  it("ignores keys inside a dialog and with modifiers", () => {
    const dialog = document.createElement("dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    expect(shortcutFor(keydown(button, "Escape"))).toBeNull();
    expect(shortcutFor(keydown(document.body, "Delete", { ctrlKey: true }))).toBeNull();
  });
});
