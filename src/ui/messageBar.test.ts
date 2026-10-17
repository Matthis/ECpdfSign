// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createMessageBar } from "./messageBar";

beforeEach(() => {
  document.body.replaceChildren();
});

function setup() {
  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.dataset.kind = "error";
  bar.hidden = true;
  const text = document.createElement("span");
  const close = document.createElement("button");
  bar.append(text, close);
  document.body.append(bar);
  return { bar, text, close, messages: createMessageBar(bar, text, close) };
}

function expectState(
  bar: HTMLElement,
  text: HTMLElement,
  expected: { kind: string; role: string; text: string; hidden: boolean },
): void {
  expect(bar.dataset.kind).toBe(expected.kind);
  expect(bar.getAttribute("role")).toBe(expected.role);
  expect(text.textContent).toBe(expected.text);
  expect(bar.hidden).toBe(expected.hidden);
}

describe("message bar", () => {
  it("switches between error and info variants and hides", () => {
    const { bar, text, messages } = setup();

    messages.show("Die Datei konnte nicht gelesen werden.");
    expectState(bar, text, {
      kind: "error",
      role: "alert",
      text: "Die Datei konnte nicht gelesen werden.",
      hidden: false,
    });

    messages.info("Gespeichert: Vertrag_signiert.pdf");
    expectState(bar, text, {
      kind: "info",
      role: "status",
      text: "Gespeichert: Vertrag_signiert.pdf",
      hidden: false,
    });

    messages.show("Die PDF-Datei konnte nicht erstellt werden.");
    expectState(bar, text, {
      kind: "error",
      role: "alert",
      text: "Die PDF-Datei konnte nicht erstellt werden.",
      hidden: false,
    });

    messages.hide();
    expectState(bar, text, { kind: "error", role: "alert", text: "", hidden: true });
  });

  it("hides when the close button is clicked", () => {
    const { bar, text, close, messages } = setup();
    messages.info("Gespeichert: x.pdf");
    close.click();
    expect(bar.hidden).toBe(true);
    expect(text.textContent).toBe("");
  });
});
