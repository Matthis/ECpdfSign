// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addImage,
  addPlaceDate,
  addSignature,
  createDocumentState,
  getElement,
  type PlaceDateElement,
  removeElement,
  selectElement,
  updateElementGeometry,
  updatePlaceDateText,
} from "../model";
import { isEmptyPlaceDate } from "../placeDate/format";
import type { PageViewport } from "../pdf/viewport";
import { boxFromGeometry, boxToGeometry, type Box, type ElementGeometry } from "./geometry";
import { createOverlay, formatAngle, handleCursor, type Overlay } from "./overlay";

/**
 * Behaves like a pdf.js viewport of a page with /Rotate 90 and a 400x500
 * CropBox at (50, 100): screen x runs along PDF y, screen y along PDF x.
 */
function rotatedViewport(scale: number): PageViewport {
  return {
    width: 500 * scale,
    height: 400 * scale,
    convertToViewportPoint: (x: number, y: number) => [(y - 100) * scale, (x - 50) * scale],
    convertToPdfPoint: (x: number, y: number) => [y / scale + 50, x / scale + 100],
  } as unknown as PageViewport;
}

let urlCount = 0;

function setup(pageCount = 5) {
  const state = createDocumentState("a.pdf", new Uint8Array(), pageCount);
  const container = document.createElement("section");
  const stage = document.createElement("div");
  const canvas = document.createElement("canvas");
  stage.append(canvas);
  container.append(stage);
  document.body.append(container);
  const env = {
    createObjectURL: vi.fn(() => `blob:test/${++urlCount}`),
    revokeObjectURL: vi.fn(),
  };
  let overlay!: Overlay;
  // Stands in for the app: update the model, then redraw.
  const callbacks = {
    select: vi.fn((id: string | null) => {
      selectElement(state, id);
      overlay.sync(state);
    }),
    update: vi.fn((id: string, g: ElementGeometry) => {
      updateElementGeometry(state, id, g.rect, g.rotation, g.fontSize);
      overlay.sync(state);
    }),
    remove: vi.fn((id: string) => {
      removeElement(state, id);
      overlay.sync(state);
    }),
    editPlaceDate: vi.fn((id: string) => {
      selectElement(state, id);
      state.editingElementId = id;
      overlay.sync(state);
    }),
    commitPlaceDate: vi.fn((id: string, place: string, date: string) => {
      state.editingElementId = null;
      const element = getElement(state, id);
      if (isEmptyPlaceDate(place, date)) removeElement(state, id);
      else if (element) updatePlaceDateText(state, id, place, date, element.rect);
      overlay.sync(state);
    }),
    cancelPlaceDate: vi.fn((_id: string) => {
      state.editingElementId = null;
      overlay.sync(state);
    }),
  };
  overlay = createOverlay(stage, container, callbacks, env);
  let viewport = rotatedViewport(1);
  overlay.sync(state);
  overlay.setShownPage({ pageIndex: 0, viewport });

  function add(pageIndex: number, box: Box, bytes = new Uint8Array([1, 2, 3])) {
    const imageId = addImage(state, bytes, 300, 100);
    const element = addSignature(state, { pageIndex, imageId, ...boxToGeometry(viewport, box) });
    overlay.sync(state);
    return element;
  }

  function addText(pageIndex: number, box: Box, place = "München", date = "17.10.2026", fontSize = 11) {
    const element = addPlaceDate(state, {
      pageIndex,
      place,
      date,
      fontSize,
      ...boxToGeometry(viewport, box),
    });
    overlay.sync(state);
    return element;
  }

  function show(pageIndex: number, scale = 1) {
    viewport = rotatedViewport(scale);
    overlay.setShownPage({ pageIndex, viewport });
  }

  const imgs = () => Array.from(stage.querySelectorAll<HTMLImageElement>("img.placed-signature"));
  const frame = () => stage.querySelector<HTMLElement>(".element-frame")!;
  const handle = (name: string) => stage.querySelector<HTMLElement>(`[data-handle="${name}"]`)!;
  const shownBox = (el: HTMLElement) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  });
  return {
    state,
    stage,
    container,
    canvas,
    env,
    callbacks,
    overlay,
    add,
    addText,
    show,
    imgs,
    frame,
    handle,
    shownBox,
    viewport: () => viewport,
  };
}

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  init: { button?: number; buttons?: number; shiftKey?: boolean; pointerId?: number } = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
      buttons: init.buttons ?? (type === "pointerup" ? 0 : 1),
      shiftKey: init.shiftKey ?? false,
      clientX: x,
      clientY: y,
    }),
  );
}

const BOX: Box = { cx: 200, cy: 150, width: 120, height: 40, rotation: 0 };

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rendering", () => {
  it("shows the page's signatures as blob-URL images in a page-clipped layer, the frame outside it", () => {
    const { add, imgs, frame, stage, canvas, env } = setup();
    const a = add(0, BOX);
    add(0, { ...BOX, cx: 300 });
    add(1, BOX);

    expect(imgs()).toHaveLength(2);
    expect(imgs()[0].dataset.elementId).toBe(a.id);
    // Same bytes: one blob URL shared by both images.
    expect(env.createObjectURL).toHaveBeenCalledTimes(1);
    expect(imgs()[0].getAttribute("src")).toBe(imgs()[1].getAttribute("src"));
    expect(imgs()[0].parentElement?.className).toBe("overlay-images");
    expect(frame().parentElement?.className).toBe("overlay-frames");
    expect(frame().parentElement?.contains(imgs()[0])).toBe(false);
    expect(stage.firstElementChild).toBe(canvas);
    expect(frame().hidden).toBe(true);
  });

  it("positions an upright image from the stored geometry", () => {
    const { add, imgs, shownBox } = setup();
    add(0, { ...BOX, rotation: 30 });
    const box = shownBox(imgs()[0]);
    expect(box.left).toBeCloseTo(140);
    expect(box.top).toBeCloseTo(130);
    expect(box.width).toBeCloseTo(120);
    expect(box.height).toBeCloseTo(40);
    expect(imgs()[0].style.transform).toBe("rotate(30deg)");
  });

  it("shows the frame with 8 handles, the '×' and the rotation handle for the selected signature", () => {
    const { add, state, overlay, frame, shownBox, stage } = setup();
    const a = add(0, BOX);
    selectElement(state, a.id);
    overlay.sync(state);

    expect(frame().hidden).toBe(false);
    expect(shownBox(frame())).toEqual({ left: 140, top: 130, width: 120, height: 40 });
    expect(frame().querySelectorAll(".frame-handle.corner")).toHaveLength(4);
    expect(frame().querySelectorAll(".frame-handle.edge")).toHaveLength(4);
    expect(frame().querySelector(".frame-remove")?.textContent).toBe("×");
    expect(frame().querySelector(".frame-rotate-handle")).not.toBeNull();
    expect(stage.querySelector<HTMLElement>(".rotation-badge")?.hidden).toBe(true);
  });
});

describe("selecting and moving", () => {
  it("left button down selects and drags; release stops it", () => {
    const { add, imgs, callbacks, state, shownBox } = setup();
    const a = add(0, BOX);
    const img = imgs()[0];

    pointer(img, "pointerdown", 100, 100);
    expect(callbacks.select).toHaveBeenCalledWith(a.id);
    expect(state.selectedElementId).toBe(a.id);

    pointer(img, "pointermove", 130, 90);
    expect(shownBox(img).left).toBeCloseTo(170);
    expect(shownBox(img).top).toBeCloseTo(120);

    pointer(img, "pointerup", 130, 90);
    callbacks.update.mockClear();
    pointer(img, "pointermove", 200, 200, { buttons: 0 });
    expect(callbacks.update).not.toHaveBeenCalled();
    expect(shownBox(img).left).toBeCloseTo(170);
  });

  it("ignores the right and middle buttons", () => {
    const { add, imgs, callbacks, state } = setup();
    add(0, BOX);
    for (const button of [1, 2]) {
      pointer(imgs()[0], "pointerdown", 100, 100, { button, buttons: button === 1 ? 4 : 2 });
      pointer(imgs()[0], "pointermove", 150, 150, { buttons: button === 1 ? 4 : 2 });
    }
    expect(callbacks.select).not.toHaveBeenCalled();
    expect(callbacks.update).not.toHaveBeenCalled();
    expect(state.selectedElementId).toBeNull();
  });

  it("stops moving if the left button is no longer held", () => {
    const { add, imgs, callbacks } = setup();
    add(0, BOX);
    pointer(imgs()[0], "pointerdown", 100, 100);
    pointer(imgs()[0], "pointermove", 110, 100, { buttons: 0 });
    pointer(imgs()[0], "pointermove", 120, 100);
    expect(callbacks.update).not.toHaveBeenCalled();
  });

  it("drags the selected signature by its frame", () => {
    const { add, state, overlay, frame, callbacks, imgs, shownBox } = setup();
    const a = add(0, BOX);
    selectElement(state, a.id);
    overlay.sync(state);
    pointer(frame(), "pointerdown", 0, 0);
    pointer(frame(), "pointermove", -10, 25);
    expect(callbacks.update).toHaveBeenCalled();
    expect(shownBox(imgs()[0]).left).toBeCloseTo(130);
    expect(shownBox(frame()).top).toBeCloseTo(155);
  });

  it("keeps 16 px on the page when dragged far off it", () => {
    const { add, imgs, shownBox } = setup();
    add(0, BOX);
    pointer(imgs()[0], "pointerdown", 0, 0);
    pointer(imgs()[0], "pointermove", -5000, -5000);
    const box = shownBox(imgs()[0]);
    expect(box.left + box.width).toBeCloseTo(16);
    expect(box.top + box.height).toBeCloseTo(16);
  });

  it("deselects on empty page area, but not on a right click", () => {
    const { add, imgs, canvas, callbacks, state, frame } = setup();
    const a = add(0, BOX);
    pointer(imgs()[0], "pointerdown", 0, 0);
    pointer(imgs()[0], "pointerup", 0, 0);
    expect(frame().hidden).toBe(false);

    pointer(canvas, "pointerdown", 5, 5, { button: 2, buttons: 2 });
    expect(state.selectedElementId).toBe(a.id);
    pointer(canvas, "pointerdown", 5, 5);
    expect(callbacks.select).toHaveBeenLastCalledWith(null);
    expect(frame().hidden).toBe(true);
  });
});

describe("handles", () => {
  function selected() {
    const ctx = setup();
    const a = ctx.add(0, { ...BOX, rotation: 30 });
    selectElement(ctx.state, a.id);
    ctx.overlay.sync(ctx.state);
    return { ...ctx, a };
  }

  it("corner handles scale with a fixed aspect ratio", () => {
    const { handle, frame, shownBox } = selected();
    pointer(handle("se"), "pointerdown", 0, 0);
    pointer(handle("se"), "pointermove", 40, 30);
    const box = shownBox(frame());
    expect(box.width / box.height).toBeCloseTo(3);
    expect(box.width).toBeGreaterThan(120);
  });

  it("edge handles change only one dimension", () => {
    const { handle, frame, shownBox } = selected();
    pointer(handle("e"), "pointerdown", 0, 0);
    pointer(handle("e"), "pointermove", 40, 0);
    expect(shownBox(frame()).height).toBeCloseTo(40);
    expect(shownBox(frame()).width).toBeGreaterThan(120);
  });

  it("stops at 16 px on the short side", () => {
    const { handle, frame, shownBox } = selected();
    pointer(handle("s"), "pointerdown", 0, 0);
    pointer(handle("s"), "pointermove", 0, -500);
    expect(shownBox(frame()).height).toBeCloseTo(16);
  });

  it("the rotation handle rotates about the center, shows the angle and snaps", () => {
    const { stage, frame, shownBox, state, a } = selected();
    const knob = frame().querySelector<HTMLElement>(".frame-rotate-handle")!;
    const badge = stage.querySelector<HTMLElement>(".rotation-badge")!;
    const before = shownBox(frame());
    // happy-dom places the stage at (0, 0), so client = viewport coordinates.
    // Start straight above the center (cx 200, cy 150), sweep to the right: +90°.
    pointer(knob, "pointerdown", 200, 50);
    expect(badge.hidden).toBe(false);
    pointer(knob, "pointermove", 300, 150);
    expect(a.rotation).toBeCloseTo(120);
    expect(badge.textContent).toBe("120°");
    expect(shownBox(frame()).left).toBeCloseTo(before.left);

    // 30 + 58 = 88 -> snaps to 90.
    const angle = (58 * Math.PI) / 180;
    pointer(knob, "pointermove", 200 + 100 * Math.sin(angle), 150 - 100 * Math.cos(angle));
    expect(a.rotation).toBe(90);

    // Shift: 15° steps (30 + 20 = 50 -> 45).
    const twenty = (20 * Math.PI) / 180;
    pointer(knob, "pointermove", 200 + 100 * Math.sin(twenty), 150 - 100 * Math.cos(twenty), {
      shiftKey: true,
    });
    expect(a.rotation).toBe(45);

    pointer(knob, "pointerup", 0, 0);
    expect(badge.hidden).toBe(true);
    expect(state.elements[0].rotation).toBe(45);
  });

  it("rotates by the same angles when the stage is not at the window origin", () => {
    const { stage, frame, a } = selected();
    const origin = { x: 300, y: 80 };
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: origin.x,
      top: origin.y,
      x: origin.x,
      y: origin.y,
      width: 500,
      height: 400,
      right: origin.x + 500,
      bottom: origin.y + 400,
      toJSON: () => ({}),
    } as DOMRect);
    const knob = frame().querySelector<HTMLElement>(".frame-rotate-handle")!;
    // Center (200, 150) in viewport space, offset by the stage's client position.
    const at = (degreesFromUp: number) => {
      const r = (degreesFromUp * Math.PI) / 180;
      return [origin.x + 200 + 100 * Math.sin(r), origin.y + 150 - 100 * Math.cos(r)] as const;
    };

    pointer(knob, "pointerdown", ...at(0));
    pointer(knob, "pointermove", ...at(90));
    expect(a.rotation).toBeCloseTo(120);
    pointer(knob, "pointermove", ...at(58));
    expect(a.rotation).toBe(90);
    pointer(knob, "pointermove", ...at(20), { shiftKey: true });
    expect(a.rotation).toBe(45);
    pointer(knob, "pointerup", ...at(20));
  });

  it("double-clicking keeps 16 px on the page when the upright box would leave it", () => {
    const { add, state, overlay, frame, shownBox } = setup();
    // At 90° the 120x40 box is 120 px tall; only its bottom 16 px are on the page.
    const a = add(0, { cx: 200, cy: -44, width: 120, height: 40, rotation: 90 });
    selectElement(state, a.id);
    overlay.sync(state);
    const knob = frame().querySelector<HTMLElement>(".frame-rotate-handle")!;

    knob.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(a.rotation).toBe(0);
    const box = shownBox(frame());
    expect(box.top + box.height).toBeCloseTo(16);
  });

  it("double-clicking the rotation handle resets to 0°", () => {
    const { frame, a } = selected();
    const knob = frame().querySelector<HTMLElement>(".frame-rotate-handle")!;
    knob.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(a.rotation).toBe(0);
  });

  it("the '×' removes the signature", () => {
    const { frame, callbacks, a, imgs, state } = selected();
    frame().querySelector<HTMLButtonElement>(".frame-remove")!.click();
    expect(callbacks.remove).toHaveBeenCalledWith(a.id);
    expect(imgs()).toHaveLength(0);
    expect(frame().hidden).toBe(true);
    expect(state.elements).toHaveLength(0);
  });

  it("a new viewport mid-drag ends the drag", () => {
    const { handle, callbacks, show } = selected();
    pointer(handle("se"), "pointerdown", 0, 0);
    show(0, 1.5);
    callbacks.update.mockClear();
    pointer(handle("se"), "pointermove", 40, 30);
    expect(callbacks.update).not.toHaveBeenCalled();
  });

  it("uses resize cursors that follow the rotation", () => {
    expect(handleCursor("e", 0)).toBe("ew-resize");
    expect(handleCursor("e", 90)).toBe("ns-resize");
    expect(handleCursor("se", 0)).toBe("nwse-resize");
    expect(handleCursor("n", 45)).toBe("nesw-resize");
    expect(formatAngle(11.6)).toBe("12°");
    expect(formatAngle(359.7)).toBe("0°");
  });
});

describe("pages, resizing and blob URLs", () => {
  it("shows only the current page's signatures, unchanged when returning", () => {
    const { add, show, imgs, shownBox } = setup();
    const onTwo = add(1, BOX);
    const onFive = add(4, { ...BOX, cx: 300, rotation: 45 });

    show(1);
    expect(imgs().map((i) => i.dataset.elementId)).toEqual([onTwo.id]);
    const before = shownBox(imgs()[0]);
    show(4);
    expect(imgs().map((i) => i.dataset.elementId)).toEqual([onFive.id]);
    show(1);
    expect(shownBox(imgs()[0])).toEqual(before);
  });

  it("keeps 20 signatures' page-relative geometry across page switches and window resizes", () => {
    const { add, show, imgs, shownBox, state, viewport } = setup(4);
    const placed = new Map<string, Box>();
    for (let i = 0; i < 20; i++) {
      const box = { cx: 40 + i * 20, cy: 30 + i * 15, width: 60 + i, height: 20 + i / 2, rotation: (i * 17) % 360 };
      placed.set(add(i % 4, box).id, box);
    }
    expect(state.elements).toHaveLength(20);
    const atScale1 = viewport();
    expect(atScale1.width).toBe(500);

    for (const scale of [0.6, 1.7]) {
      for (let page = 0; page < 4; page++) {
        show(page, scale);
        const shownImgs = imgs();
        expect(shownImgs).toHaveLength(5);
        for (const img of shownImgs) {
          const box = placed.get(img.dataset.elementId!)!;
          const r = shownBox(img);
          expect(r.left).toBeCloseTo((box.cx - box.width / 2) * scale, 6);
          expect(r.top).toBeCloseTo((box.cy - box.height / 2) * scale, 6);
          expect(r.width).toBeCloseTo(box.width * scale, 6);
          expect(r.height).toBeCloseTo(box.height * scale, 6);
          expect(img.style.transform).toBe(box.rotation ? `rotate(${box.rotation}deg)` : "");
        }
      }
    }
  });

  it("each of many signatures is individually selectable", () => {
    const { add, imgs, state } = setup(1);
    for (let i = 0; i < 20; i++) add(0, { ...BOX, cx: 30 + i * 20 });
    for (const [i, img] of imgs().entries()) {
      pointer(img, "pointerdown", 0, 0, { pointerId: i + 10 });
      pointer(img, "pointerup", 0, 0, { pointerId: i + 10 });
      expect(state.selectedElementId).toBe(state.elements[i].id);
    }
  });

  it("revokes a blob URL once its image is gone, and all of them on document change", () => {
    const { add, state, overlay, env, imgs } = setup();
    const a = add(0, BOX, new Uint8Array([1]));
    const b = add(0, BOX, new Uint8Array([2]));
    add(0, BOX, new Uint8Array([2]));
    expect(env.createObjectURL).toHaveBeenCalledTimes(2);
    const urlA = imgs()[0].getAttribute("src");

    removeElement(state, a.id);
    overlay.sync(state);
    expect(env.revokeObjectURL).toHaveBeenCalledWith(urlA);
    removeElement(state, b.id); // its image is still used by the third
    overlay.sync(state);
    expect(env.revokeObjectURL).toHaveBeenCalledTimes(1);

    overlay.sync(createDocumentState("b.pdf", new Uint8Array(), 1));
    expect(env.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(imgs()).toHaveLength(0);
  });

  it("shows nothing without a shown page", () => {
    const { add, overlay, imgs } = setup();
    add(0, BOX);
    overlay.setShownPage(null);
    expect(imgs()).toHaveLength(0);
  });

  it("geometry round-trips through the fake rotated viewport", () => {
    const vp = rotatedViewport(1.3);
    const box = { cx: 80, cy: 60, width: 50, height: 20, rotation: 30 };
    const back = boxFromGeometry(vp, boxToGeometry(vp, box));
    expect(back.cx).toBeCloseTo(80);
    expect(back.width).toBeCloseTo(50);
  });
});

describe("place/date texts", () => {
  const TEXT_BOX: Box = { cx: 200, cy: 150, width: 132, height: 15, rotation: 0 };
  const spans = (stage: HTMLElement) =>
    Array.from(stage.querySelectorAll<HTMLElement>(".overlay-images .placed-text"));
  const editor = (stage: HTMLElement) => stage.querySelector<HTMLElement>(".place-date-editor")!;
  const placeInput = (stage: HTMLElement) => editor(stage).querySelector<HTMLInputElement>("input[type=text]")!;
  const dateInput = (stage: HTMLElement) => editor(stage).querySelector<HTMLInputElement>("input[type=date]")!;
  const key = (target: HTMLElement, k: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

  it("renders the text in the page-clipped layer, in its box, with the font size scaled to the zoom", () => {
    const { stage, addText, show, shownBox } = setup();
    addText(0, TEXT_BOX, "Łódź", "17.10.2026", 11);
    show(0, 2);
    const [span] = spans(stage);
    expect(span.textContent).toBe("Łódź, 17.10.2026");
    expect(parseFloat(span.style.fontSize)).toBeCloseTo(22);
    const box = shownBox(span);
    expect(box.width).toBeCloseTo(264);
    expect(box.height).toBeCloseTo(30);
    expect(parseFloat(span.style.lineHeight)).toBeCloseTo(30);
  });

  it("shows only the part that is given", () => {
    const { stage, addText } = setup();
    addText(0, TEXT_BOX, "", "17.10.2026");
    addText(0, { ...TEXT_BOX, cy: 250 }, "Zürich", "");
    expect(spans(stage).map((s) => s.textContent)).toEqual(["17.10.2026", "Zürich"]);
  });

  it("shows the frame with corner handles only, the rotation handle and the '×'", () => {
    const { stage, state, addText, overlay, frame } = setup();
    const t = addText(0, { ...TEXT_BOX, rotation: 30 });
    selectElement(state, t.id);
    overlay.sync(state);
    expect(frame().hidden).toBe(false);
    const visible = Array.from(frame().querySelectorAll<HTMLElement>(".frame-handle"))
      .filter((h) => !h.hidden)
      .map((h) => h.dataset.handle)
      .sort();
    expect(visible).toEqual(["ne", "nw", "se", "sw"]);
    expect(frame().querySelector(".frame-rotate-handle")).not.toBeNull();
    expect(frame().querySelector(".frame-remove")).not.toBeNull();
    expect(spans(stage)[0].style.transform).toBe("rotate(30deg)");
  });

  it("a signature keeps all 8 handles, also after a text was selected", () => {
    const { state, add, addText, overlay, frame } = setup();
    const visible = () =>
      Array.from(frame().querySelectorAll<HTMLElement>(".frame-handle"))
        .filter((h) => !h.hidden)
        .map((h) => h.dataset.handle)
        .sort();
    const all = ["e", "n", "ne", "nw", "s", "se", "sw", "w"];
    const sig = add(0, BOX);
    const t = addText(0, { ...TEXT_BOX, cy: 300 });
    selectElement(state, sig.id);
    overlay.sync(state);
    expect(visible()).toEqual(all);
    selectElement(state, t.id);
    overlay.sync(state);
    expect(visible()).toHaveLength(4);
    selectElement(state, sig.id);
    overlay.sync(state);
    expect(visible()).toEqual(all);
  });

  it("a corner handle scales the font size and keeps the aspect ratio", () => {
    const { state, addText, overlay, handle, callbacks } = setup();
    const t = addText(0, TEXT_BOX);
    selectElement(state, t.id);
    overlay.sync(state);
    pointer(handle("se"), "pointerdown", 0, 0);
    pointer(handle("se"), "pointermove", 66, 0);
    const geometry = callbacks.update.mock.calls.at(-1)![1];
    expect(geometry.fontSize).toBeGreaterThan(11);
    const text = getElement(state, t.id) as PlaceDateElement;
    expect(text.fontSize).toBe(geometry.fontSize);
    const box = boxFromGeometry(rotatedViewport(1), text);
    expect(box.width / box.height).toBeCloseTo(132 / 15, 6);
    expect(text.fontSize / 11).toBeCloseTo(box.height / 15, 6);
  });

  it("never scales below 6 pt", () => {
    const { state, addText, overlay, handle } = setup();
    const t = addText(0, TEXT_BOX);
    selectElement(state, t.id);
    overlay.sync(state);
    pointer(handle("nw"), "pointerdown", 0, 0);
    pointer(handle("nw"), "pointermove", 400, 400);
    expect((getElement(state, t.id) as PlaceDateElement).fontSize).toBeCloseTo(6, 9);
  });

  it("moves and rotates like a signature", () => {
    const { stage, state, addText, frame } = setup();
    const t = addText(0, TEXT_BOX);
    const [span] = spans(stage);
    pointer(span, "pointerdown", 10, 10);
    expect(state.selectedElementId).toBe(t.id);
    pointer(span, "pointermove", 30, 15);
    pointer(span, "pointerup", 30, 15);
    const moved = boxFromGeometry(rotatedViewport(1), getElement(state, t.id)!);
    expect(moved.cx).toBeCloseTo(220);
    expect(moved.cy).toBeCloseTo(155);

    const knob = frame().querySelector<HTMLElement>(".frame-rotate-handle")!;
    pointer(knob, "pointerdown", 220, 55);
    pointer(knob, "pointermove", 320, 155);
    expect(getElement(state, t.id)!.rotation).toBeCloseTo(90);
  });

  it("the '×' removes the text", () => {
    const { stage, state, addText, overlay, frame, callbacks } = setup();
    const t = addText(0, TEXT_BOX);
    selectElement(state, t.id);
    overlay.sync(state);
    frame().querySelector<HTMLElement>(".frame-remove")!.click();
    expect(callbacks.remove).toHaveBeenCalledWith(t.id);
    expect(spans(stage)).toHaveLength(0);
  });

  it("double-click on the text (or its frame) opens the inline editor in its place, rotated with it", () => {
    const { stage, state, addText, overlay, frame, callbacks } = setup();
    const t = addText(0, { ...TEXT_BOX, rotation: 30 });
    spans(stage)[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(callbacks.editPlaceDate).toHaveBeenCalledWith(t.id);
    expect(state.editingElementId).toBe(t.id);
    expect(editor(stage).hidden).toBe(false);
    expect(editor(stage).style.transform).toBe("rotate(30deg)");
    expect(parseFloat(editor(stage).style.fontSize)).toBeCloseTo(11);
    expect(placeInput(stage).value).toBe("München");
    expect(dateInput(stage).value).toBe("2026-10-17");
    expect(document.activeElement).toBe(placeInput(stage));
    // The text and its frame make room for the inputs.
    expect(spans(stage)[0].style.visibility).toBe("hidden");
    expect(frame().hidden).toBe(true);

    callbacks.cancelPlaceDate(t.id);
    expect(editor(stage).hidden).toBe(true);
    selectElement(state, t.id);
    overlay.sync(state);
    frame().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(state.editingElementId).toBe(t.id);
  });

  it("Enter commits the edited parts", () => {
    const { stage, state, addText, callbacks } = setup();
    const t = addText(0, TEXT_BOX);
    callbacks.editPlaceDate(t.id);
    placeInput(stage).value = "Berlin";
    dateInput(stage).value = "2026-11-01";
    key(placeInput(stage), "Enter");
    expect(callbacks.commitPlaceDate).toHaveBeenCalledWith(t.id, "Berlin", "01.11.2026");
    expect(editor(stage).hidden).toBe(true);
    expect(spans(stage)[0].textContent).toBe("Berlin, 01.11.2026");
    expect(spans(stage)[0].style.visibility).toBe("");
    expect(state.editingElementId).toBeNull();
  });

  it("a pointerdown outside commits; one inside does not", () => {
    const { stage, container, addText, callbacks } = setup();
    const t = addText(0, TEXT_BOX);
    callbacks.editPlaceDate(t.id);
    pointer(dateInput(stage), "pointerdown", 0, 0);
    expect(callbacks.commitPlaceDate).not.toHaveBeenCalled();
    expect(callbacks.select).not.toHaveBeenCalled();
    placeInput(stage).value = "Hamburg";
    pointer(container, "pointerdown", 0, 0);
    expect(callbacks.commitPlaceDate).toHaveBeenCalledTimes(1);
    expect(callbacks.commitPlaceDate).toHaveBeenCalledWith(t.id, "Hamburg", "17.10.2026");
  });

  it("Esc cancels: the text keeps its values", () => {
    const { stage, addText, callbacks } = setup();
    const t = addText(0, TEXT_BOX, "", "17.10.2026");
    callbacks.editPlaceDate(t.id);
    placeInput(stage).value = "Mü";
    key(placeInput(stage), "Escape");
    expect(callbacks.cancelPlaceDate).toHaveBeenCalledWith(t.id);
    expect(callbacks.commitPlaceDate).not.toHaveBeenCalled();
    expect(spans(stage)[0].textContent).toBe("17.10.2026");
    // Once closed, a click elsewhere commits nothing.
    pointer(document.body, "pointerdown", 0, 0);
    expect(callbacks.commitPlaceDate).not.toHaveBeenCalled();
  });

  it("a cleared date commits as empty", () => {
    const { stage, addText, callbacks } = setup();
    const t = addText(0, TEXT_BOX);
    callbacks.editPlaceDate(t.id);
    dateInput(stage).value = "";
    key(dateInput(stage), "Enter");
    expect(callbacks.commitPlaceDate).toHaveBeenCalledWith(t.id, "München", "");
  });

  it("closes the editor when the edited text is not on the shown page any more", () => {
    const { stage, addText, show, callbacks } = setup();
    const t = addText(0, TEXT_BOX);
    callbacks.editPlaceDate(t.id);
    show(1);
    expect(editor(stage).hidden).toBe(true);
    expect(callbacks.commitPlaceDate).not.toHaveBeenCalled();
  });
});
