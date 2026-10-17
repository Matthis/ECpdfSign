// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolbar } from "./toolbar";

beforeEach(() => {
  document.body.replaceChildren();
});

function setup() {
  const container = document.createElement("header");
  document.body.append(container);
  const onAction = vi.fn();
  const toolbar = createToolbar(container, onAction);
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  const button = (action: string) => buttons.find((b) => b.dataset.action === action)!;
  return { container, onAction, toolbar, buttons, button };
}

describe("toolbar", () => {
  it("shows exactly the four German buttons in order, without 'Element entfernen'", () => {
    const { buttons } = setup();
    expect(buttons.map((b) => b.textContent)).toEqual([
      "PDF Öffnen",
      "Ort/Datum einfügen",
      "PNG Unterschrift einfügen",
      "Speichern",
    ]);
  });

  it("enables only 'PDF Öffnen' at start", () => {
    const { buttons } = setup();
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true, true]);
  });

  it("setEnabled toggles the disabled state of one button", () => {
    const { toolbar, button } = setup();
    toolbar.setEnabled("open", false);
    expect(button("open").disabled).toBe(true);
    toolbar.setEnabled("open", true);
    expect(button("open").disabled).toBe(false);
    toolbar.setEnabled("save", true);
    expect(button("save").disabled).toBe(false);
    expect(button("insertSignature").disabled).toBe(true);
  });

  it("reports clicks with the button's action", () => {
    const { onAction, button } = setup();
    button("open").click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("open");
  });

  it("does not report clicks on disabled buttons", () => {
    const { onAction, button } = setup();
    button("save").click();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the document name", () => {
    const { container, toolbar } = setup();
    toolbar.setDocumentName("Vertrag.pdf");
    expect(container.querySelector(".toolbar-docname")?.textContent).toBe("Vertrag.pdf");
    toolbar.setDocumentName(null);
    expect(container.querySelector(".toolbar-docname")?.textContent).toBe("");
  });
});
