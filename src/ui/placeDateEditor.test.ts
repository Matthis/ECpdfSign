// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaceDateEditor } from "./placeDateEditor";
import { shortcutFor } from "./keyboard";

function setup() {
  const callbacks = { commit: vi.fn(), cancel: vi.fn(), grab: vi.fn(), resized: vi.fn() };
  const frame = document.createElement("div");
  const handle = document.createElement("div");
  frame.append(handle);
  const editor = createPlaceDateEditor(callbacks, { frame });
  document.body.append(frame, editor.element);
  const place = editor.element.querySelector<HTMLInputElement>("input[type=text]")!;
  const date = editor.element.querySelector<HTMLInputElement>("input[type=date]")!;
  const separator = editor.element.querySelector<HTMLElement>(".place-date-separator")!;
  return { editor, callbacks, place, date, separator, frame, handle };
}

function mousedown(target: EventTarget): MouseEvent {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function keydown(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function pointerdown(target: EventTarget, button = 0): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("place/date editor", () => {
  it("starts hidden and closed", () => {
    const { editor } = setup();
    expect(editor.element.hidden).toBe(true);
    expect(editor.editingId).toBeNull();
  });

  it("opens with an empty, focused place input, then ', ' and the date picker prefilled", () => {
    const { editor, place, date } = setup();
    editor.open("el-1", "", "17.10.2026");
    expect(editor.element.hidden).toBe(false);
    expect(editor.editingId).toBe("el-1");
    expect(place.value).toBe("");
    expect(document.activeElement).toBe(place);
    expect(date.value).toBe("2026-10-17");
    expect(editor.element.textContent).toBe(", ");
    const order = Array.from(editor.element.children).map((c) => c.className);
    expect(order).toEqual(["place-date-place", "place-date-separator", "place-date-date"]);
  });

  it("Enter commits place and date (DD.MM.YYYY), then closes", () => {
    const { editor, callbacks, place, date } = setup();
    editor.open("el-1", "", "17.10.2026");
    place.value = "München";
    expect(keydown(place, "Enter").defaultPrevented).toBe(true);
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "München", "17.10.2026");
    expect(editor.element.hidden).toBe(true);
    expect(editor.editingId).toBeNull();

    editor.open("el-1", "München", "17.10.2026");
    date.value = "2026-11-01";
    keydown(date, "Enter");
    expect(callbacks.commit).toHaveBeenLastCalledWith("el-1", "München", "01.11.2026");
  });

  it("a cleared date commits as empty", () => {
    const { editor, callbacks, date } = setup();
    editor.open("el-1", "München", "17.10.2026");
    date.value = "";
    keydown(date, "Enter");
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "München", "");
  });

  it("Esc cancels without committing", () => {
    const { editor, callbacks, place } = setup();
    editor.open("el-1", "", "17.10.2026");
    place.value = "Mü";
    keydown(place, "Escape");
    expect(callbacks.cancel).toHaveBeenCalledWith("el-1");
    expect(callbacks.commit).not.toHaveBeenCalled();
    expect(editor.element.hidden).toBe(true);
  });

  it("a pointerdown outside commits once; inside it does nothing and does not bubble", () => {
    const { editor, callbacks, place } = setup();
    const outside = document.createElement("div");
    const bubbled = vi.fn();
    document.body.append(outside);
    document.body.addEventListener("pointerdown", bubbled);
    editor.open("el-1", "", "17.10.2026");

    pointerdown(place);
    expect(callbacks.commit).not.toHaveBeenCalled();
    expect(bubbled).not.toHaveBeenCalled();

    place.value = "Łódź";
    pointerdown(outside);
    pointerdown(outside);
    expect(callbacks.commit).toHaveBeenCalledTimes(1);
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "Łódź", "17.10.2026");
  });

  it("Tab out of the editor commits; moving between its inputs does not", () => {
    const { editor, callbacks, place, date } = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    editor.open("el-1", "", "17.10.2026");
    place.value = "Bonn";

    place.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: date }));
    expect(callbacks.commit).not.toHaveBeenCalled();
    expect(editor.editingId).toBe("el-1");

    date.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    expect(callbacks.commit).toHaveBeenCalledTimes(1);
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "Bonn", "17.10.2026");
    expect(editor.editingId).toBeNull();
  });

  it("focus leaving to nothing commits too", () => {
    const { editor, callbacks, place } = setup();
    editor.open("el-1", "Bonn", "17.10.2026");
    place.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "Bonn", "17.10.2026");
  });

  it("the ', ' separator grabs the text: no commit, focus kept, the inputs never grab", () => {
    const { editor, callbacks, place, date, separator } = setup();
    editor.open("el-1", "", "17.10.2026");
    pointerdown(separator);
    expect(callbacks.grab).toHaveBeenCalledTimes(1);
    expect(mousedown(separator).defaultPrevented).toBe(true);
    expect(callbacks.commit).not.toHaveBeenCalled();
    expect(editor.editingId).toBe("el-1");

    pointerdown(place);
    pointerdown(date);
    expect(callbacks.grab).toHaveBeenCalledTimes(1);
    // A click into an input still places the caret / opens the picker.
    expect(mousedown(place).defaultPrevented).toBe(false);
    expect(mousedown(date).defaultPrevented).toBe(false);
  });

  it("the frame is part of the editor: a pointerdown or the focus moving there does not commit", () => {
    const { editor, callbacks, place, frame, handle } = setup();
    editor.open("el-1", "Bonn", "17.10.2026");
    pointerdown(frame);
    pointerdown(handle);
    expect(mousedown(handle).defaultPrevented).toBe(true);
    place.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: handle }));
    expect(callbacks.commit).not.toHaveBeenCalled();
    expect(editor.editingId).toBe("el-1");

    // Closed, the frame is an ordinary element again.
    editor.close();
    expect(mousedown(frame).defaultPrevented).toBe(false);
  });

  it("only while a left-button grab lasts does focus leaving keep the edit open", () => {
    for (const release of ["pointerup", "pointercancel"]) {
      const { editor, callbacks, place, frame } = setup();
      const outside = document.createElement("button");
      document.body.append(outside);
      editor.open("el-1", "Bonn", "17.10.2026");
      pointerdown(frame);
      place.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
      expect(callbacks.commit).not.toHaveBeenCalled();
      frame.dispatchEvent(new PointerEvent(release, { bubbles: true, button: 0 }));
      place.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
      expect(callbacks.commit).toHaveBeenCalledWith("el-1", "Bonn", "17.10.2026");
      document.body.replaceChildren();
    }
  });

  it("a right-button pointerdown on the frame is no grab", () => {
    const { editor, callbacks, place, frame } = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    editor.open("el-1", "Bonn", "17.10.2026");
    pointerdown(frame, 2);
    expect(callbacks.commit).not.toHaveBeenCalled();
    place.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "Bonn", "17.10.2026");
  });

  it("reports when typing makes it grow", () => {
    const { editor, callbacks, place } = setup();
    editor.open("el-1", "", "17.10.2026");
    place.value = "Garmisch-Partenkirchen";
    place.dispatchEvent(new Event("input", { bubbles: true }));
    expect(callbacks.resized).toHaveBeenCalledTimes(1);
    expect(place.style.width).toBe("23ch");
  });

  it("a half-entered date keeps the previous date instead of clearing it", () => {
    const { editor, callbacks, date } = setup();
    editor.open("el-1", "", "17.10.2026");
    date.value = "";
    Object.defineProperty(date, "validity", { value: { badInput: true }, configurable: true });
    keydown(date, "Enter");
    expect(callbacks.commit).toHaveBeenCalledWith("el-1", "", "17.10.2026");
  });

  it("close() reports nothing and stops listening for outside clicks", () => {
    const { editor, callbacks } = setup();
    editor.open("el-1", "", "17.10.2026");
    editor.close();
    pointerdown(document.body);
    expect(callbacks.commit).not.toHaveBeenCalled();
    expect(callbacks.cancel).not.toHaveBeenCalled();
  });

  it("Entf, Backspace and Esc in the inputs are never element shortcuts", () => {
    const { editor, place, date } = setup();
    editor.open("el-1", "München", "17.10.2026");
    for (const target of [place, date]) {
      for (const key of ["Delete", "Backspace"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        Object.defineProperty(event, "target", { value: target });
        expect(shortcutFor(event)).toBeNull();
      }
    }
  });

  it("lies over the box: top-left corner, height, font size and rotation", () => {
    const { editor } = setup();
    editor.open("el-1", "", "17.10.2026");
    editor.position({ cx: 100, cy: 50, width: 80, height: 20, rotation: 90 }, 14.7);
    // The box's own top-left corner, rotated 90° clockwise about the center.
    expect(parseFloat(editor.element.style.left)).toBeCloseTo(110);
    expect(parseFloat(editor.element.style.top)).toBeCloseTo(10);
    expect(editor.element.style.height).toBe("20px");
    expect(editor.element.style.fontSize).toBe("14.7px");
    expect(editor.element.style.transform).toBe("rotate(90deg)");
  });
});
