// Placed signatures and place/date texts on top of the shown page, plus the
// selection frame with its handles and the inline text editor. Two layers live
// in the page stage:
// - the element layer is clipped to the page, because only that part is saved;
// - the frame layer is not clipped, so the frame, handles, "×", the angle
//   badge and the text editor stay reachable while an element hangs over the
//   page edge.
// Texts get the same frame as signatures, but only corner handles, which
// scale the font size (never stretching the glyphs).
// All interaction maths happens in viewport space (./geometry); every change is
// converted to PDF space once and handed to the app, which updates the model and
// calls `sync`, so what is drawn is always derived from the model.

import type { DocumentState, PlaceDateElement, PlacedElement, SignatureElement } from "../model";
import { elementsOnPage, getElement } from "../model";
import { formatPlaceDate } from "../placeDate/format";
import {
  boxFromGeometry,
  boxPoint,
  boxToGeometry,
  CORNERS,
  EDGES,
  isCorner,
  keepOnPage,
  moveBox,
  pdfUnitInPx,
  resizeBox,
  rotateBox,
  scaleTextBox,
  type Box,
  type ElementGeometry,
  type Handle,
  type Point,
} from "./geometry";
import type { ShownPage } from "./pageView";
import { createPlaceDateEditor } from "./placeDateEditor";

export interface OverlayCallbacks {
  /** The user selected an element (left button down on it) or clicked empty page area (`null`). */
  select(id: string | null): void;
  /** New geometry while the user moves, scales or rotates an element. */
  update(id: string, geometry: ElementGeometry): void;
  /** The user clicked the frame's "×". */
  remove(id: string): void;
  /** The user double-clicked a place/date text. */
  editPlaceDate(id: string): void;
  /** The inline editor was committed (Enter or a click outside); `date` is DD.MM.YYYY or empty. */
  commitPlaceDate(id: string, place: string, date: string): void;
  /** The inline editor was cancelled (Esc). */
  cancelPlaceDate(id: string): void;
}

export interface Overlay {
  /** Redraws from the model. Call after every model change; a new state object means a new document. */
  sync(state: DocumentState | null): void;
  /** The page under the overlay and its viewport (from the page view), or `null`. */
  setShownPage(shown: ShownPage | null): void;
}

export interface OverlayEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/** Distance from the frame's top edge to the center of the rotation handle (CSS px). */
export const ROTATE_HANDLE_OFFSET = 28;

/** Direction of each handle from the box center, in degrees clockwise (0° = right). */
const HANDLE_DIRECTION: Record<Handle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};
const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** Resize cursor that matches the handle's direction on screen once the element is rotated. */
export function handleCursor(handle: Handle, rotation: number): string {
  const direction = (((HANDLE_DIRECTION[handle] + rotation) % 180) + 180) % 180;
  return RESIZE_CURSORS[Math.round(direction / 45) % 4];
}

/** Text of the angle badge, e.g. "12°". */
export function formatAngle(rotation: number): string {
  return `${Math.round(rotation) % 360}°`;
}

type DragKind = { type: "move" } | { type: "resize"; handle: Handle } | { type: "rotate" };

interface Drag {
  id: string;
  kind: DragKind;
  pointerId: number;
  target: HTMLElement;
  startClient: Point;
  /** Pointer position in viewport space at the start. */
  startPointer: Point;
  startBox: Box;
  /** Font size at the start, for texts. */
  startFontSize: number | null;
}

const SIGNATURE_ALT = "Unterschrift";

export function createOverlay(
  stage: HTMLElement,
  background: HTMLElement,
  callbacks: OverlayCallbacks,
  env: OverlayEnv = URL,
): Overlay {
  let state: DocumentState | null = null;
  let shown: ShownPage | null = null;
  let drag: Drag | null = null;
  const images = new Map<string, HTMLImageElement>();
  const texts = new Map<string, HTMLElement>();
  const urls = new Map<string, string>();

  const editor = createPlaceDateEditor({
    commit: (id, place, date) => callbacks.commitPlaceDate(id, place, date),
    cancel: (id) => callbacks.cancelPlaceDate(id),
  });

  const imageLayer = document.createElement("div");
  imageLayer.className = "overlay-images";
  const frameLayer = document.createElement("div");
  frameLayer.className = "overlay-frames";

  const frame = document.createElement("div");
  frame.className = "element-frame";
  frame.hidden = true;

  const handles = new Map<Handle, HTMLElement>();
  for (const handle of [...CORNERS, ...EDGES]) {
    const el = document.createElement("div");
    el.className = `frame-handle ${isCorner(handle) ? "corner" : "edge"}`;
    el.dataset.handle = handle;
    el.addEventListener("pointerdown", (event) =>
      startDrag(event, el, { type: "resize", handle }),
    );
    handles.set(handle, el);
    frame.append(el);
  }

  const rotateLine = document.createElement("div");
  rotateLine.className = "frame-rotate-line";
  rotateLine.style.top = `${-ROTATE_HANDLE_OFFSET}px`;
  rotateLine.style.height = `${ROTATE_HANDLE_OFFSET}px`;
  const rotateHandle = document.createElement("div");
  rotateHandle.className = "frame-rotate-handle";
  rotateHandle.title = "Drehen (Umschalt: 15°-Schritte, Doppelklick: 0°)";
  rotateHandle.style.top = `${-ROTATE_HANDLE_OFFSET}px`;
  rotateHandle.addEventListener("pointerdown", (event) =>
    startDrag(event, rotateHandle, { type: "rotate" }),
  );
  rotateHandle.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    const selected = selectedOnPage();
    if (!selected || !shown) return;
    const box = { ...boxFromGeometry(shown.viewport, selected), rotation: 0 };
    const page = { width: shown.viewport.width, height: shown.viewport.height };
    callbacks.update(selected.id, boxToGeometry(shown.viewport, keepOnPage(box, page)));
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "frame-remove";
  removeButton.textContent = "×";
  removeButton.title = "Element entfernen (Entf)";
  removeButton.setAttribute("aria-label", "Element entfernen");
  removeButton.setAttribute("aria-keyshortcuts", "Delete Backspace");
  removeButton.addEventListener("pointerdown", (event) => {
    // Neither start a move on the frame nor deselect via the background.
    event.stopPropagation();
  });
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const selected = selectedOnPage();
    if (selected) callbacks.remove(selected.id);
  });

  frame.append(rotateLine, rotateHandle, removeButton);
  frame.addEventListener("pointerdown", (event) => {
    if (event.target === frame) startDrag(event, frame, { type: "move" });
  });
  // The frame lies on top of the selected element, so it gets the double-click.
  frame.addEventListener("dblclick", (event) => {
    if (event.target !== frame) return;
    const selected = selectedOnPage();
    if (selected?.kind === "placeDate") callbacks.editPlaceDate(selected.id);
  });

  const badge = document.createElement("div");
  badge.className = "rotation-badge";
  badge.hidden = true;

  frameLayer.append(frame, badge, editor.element);
  stage.append(imageLayer, frameLayer);

  background.addEventListener("pointerdown", (event) => {
    // Elements and the frame stop propagation, so this is empty page area.
    if (event.button === 0 && state?.selectedElementId) callbacks.select(null);
  });

  function selectedOnPage(): PlacedElement | null {
    if (!state || !shown || state.selectedElementId === null) return null;
    const element = getElement(state, state.selectedElementId);
    return element && element.pageIndex === shown.pageIndex ? element : null;
  }

  /** The text whose editor is open, if it is on the shown page. */
  function editingOnPage(): PlaceDateElement | null {
    if (!state || !shown || state.editingElementId === null) return null;
    const element = getElement(state, state.editingElementId);
    return element?.kind === "placeDate" && element.pageIndex === shown.pageIndex ? element : null;
  }

  function urlFor(imageId: string): string | null {
    const existing = urls.get(imageId);
    if (existing) return existing;
    const image = state?.images.get(imageId);
    if (!image) return null;
    const url = env.createObjectURL(
      new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
    );
    urls.set(imageId, url);
    return url;
  }

  function revokeUnused(): void {
    for (const [imageId, url] of urls) {
      if (!state?.images.has(imageId)) {
        env.revokeObjectURL(url);
        urls.delete(imageId);
      }
    }
  }

  function placeBox(el: HTMLElement, box: Box): void {
    el.style.left = `${box.cx - box.width / 2}px`;
    el.style.top = `${box.cy - box.height / 2}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    el.style.transform = box.rotation ? `rotate(${box.rotation}deg)` : "";
  }

  function createImage(element: SignatureElement): HTMLImageElement {
    const img = document.createElement("img");
    img.className = "placed-signature";
    img.alt = SIGNATURE_ALT;
    img.draggable = false;
    img.dataset.elementId = element.id;
    img.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; // only the left button grabs
      callbacks.select(element.id);
      startDrag(event, img, { type: "move" }, element.id);
    });
    return img;
  }

  function createText(element: PlaceDateElement): HTMLElement {
    const span = document.createElement("span");
    span.className = "placed-text";
    span.dataset.elementId = element.id;
    span.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; // only the left button grabs
      callbacks.select(element.id);
      startDrag(event, span, { type: "move" }, element.id);
    });
    span.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      callbacks.editPlaceDate(element.id);
    });
    return span;
  }

  /**
   * Lays a text out in its box: the box top is the ascender line and the line
   * height is ascender minus descender (the @font-face pins the font's own
   * metrics to exactly that), so the baseline lands where the PDF draws it.
   */
  function placeText(
    span: HTMLElement,
    element: PlaceDateElement,
    box: Box,
    pxPerUnit: number,
  ): void {
    const text = formatPlaceDate(element.place, element.date);
    if (span.textContent !== text) span.textContent = text;
    placeBox(span, box);
    span.style.fontSize = `${element.fontSize * pxPerUnit}px`;
    span.style.lineHeight = `${box.height}px`;
  }

  function layout(): void {
    const onPage: PlacedElement[] = state && shown ? elementsOnPage(state, shown.pageIndex) : [];
    const editing = editingOnPage();
    const pxPerUnit = shown ? pdfUnitInPx(shown.viewport) : 1;
    const keep = new Set<string>();
    for (const element of onPage) {
      if (!shown) continue;
      if (element.kind === "placeDate") {
        keep.add(element.id);
        let span = texts.get(element.id);
        if (!span) {
          // Appended once (moving a node would drop its pointer capture); elements
          // are only ever added at the end of the model, so the order matches.
          span = createText(element);
          texts.set(element.id, span);
          imageLayer.append(span);
        }
        placeText(span, element, boxFromGeometry(shown.viewport, element), pxPerUnit);
        span.style.visibility = editing?.id === element.id ? "hidden" : "";
        continue;
      }
      const src = urlFor(element.imageId);
      if (!src) continue;
      keep.add(element.id);
      let img = images.get(element.id);
      if (!img) {
        img = createImage(element);
        images.set(element.id, img);
        imageLayer.append(img);
      }
      if (img.getAttribute("src") !== src) img.src = src;
      placeBox(img, boxFromGeometry(shown.viewport, element));
    }
    for (const nodes of [images, texts] as Map<string, HTMLElement>[]) {
      for (const [id, node] of nodes) {
        if (!keep.has(id)) {
          node.remove();
          nodes.delete(id);
        }
      }
    }
    revokeUnused();

    if (editing && shown) {
      if (editor.editingId !== editing.id) editor.open(editing.id, editing.place, editing.date);
      editor.position(boxFromGeometry(shown.viewport, editing), editing.fontSize * pxPerUnit);
    } else if (editor.editingId !== null) {
      editor.close();
    }

    const selected = selectedOnPage();
    if (drag && (!selected || selected.id !== drag.id)) endDrag();
    // While a text is edited, its inputs take the place of the frame.
    if (!selected || !shown || selected.id === editing?.id) {
      frame.hidden = true;
      badge.hidden = true;
      return;
    }
    const box = boxFromGeometry(shown.viewport, selected);
    frame.hidden = false;
    placeBox(frame, box);
    for (const [handle, el] of handles) {
      el.style.cursor = handleCursor(handle, box.rotation);
      // Texts only scale (corners); stretching one side would distort the glyphs.
      el.hidden = selected.kind === "placeDate" && !isCorner(handle);
    }
    // Keep the "×" glyph upright.
    removeButton.style.transform = box.rotation ? `rotate(${-box.rotation}deg)` : "";

    if (drag?.kind.type === "rotate") {
      const knob = boxPoint(box, 0, -box.height / 2 - ROTATE_HANDLE_OFFSET);
      badge.hidden = false;
      badge.textContent = formatAngle(box.rotation);
      badge.style.left = `${knob.x + 14}px`;
      badge.style.top = `${knob.y - 14}px`;
    } else {
      badge.hidden = true;
    }
  }

  function startDrag(event: PointerEvent, target: HTMLElement, kind: DragKind, id?: string): void {
    // Other buttons do nothing; the left button selects and grabs.
    if (event.button !== 0 || !state || !shown) return;
    event.preventDefault();
    event.stopPropagation();
    const elementId = id ?? state.selectedElementId;
    const element = elementId === null ? undefined : getElement(state, elementId);
    if (!element) return;
    endDrag();
    const stageRect = stage.getBoundingClientRect();
    drag = {
      id: element.id,
      kind,
      pointerId: event.pointerId,
      target,
      startClient: { x: event.clientX, y: event.clientY },
      startPointer: { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top },
      startBox: boxFromGeometry(shown.viewport, element),
      startFontSize: element.kind === "placeDate" ? element.fontSize : null,
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (e.g. released before this ran); the drag ends on pointerup.
    }
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerEnd);
    target.addEventListener("pointercancel", onPointerEnd);
    target.addEventListener("lostpointercapture", onPointerEnd);
    layout();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId || !shown) return;
    if ((event.buttons & 1) === 0) {
      // The left button is no longer held (release got lost): stop moving.
      endDrag();
      return;
    }
    const dx = event.clientX - drag.startClient.x;
    const dy = event.clientY - drag.startClient.y;
    let box: Box;
    let fontSize: number | undefined;
    switch (drag.kind.type) {
      case "move":
        box = moveBox(drag.startBox, dx, dy);
        break;
      case "resize":
        if (drag.startFontSize !== null) {
          const { handle } = drag.kind;
          if (!isCorner(handle)) return; // texts have no edge handles
          ({ box, fontSize } = scaleTextBox(drag.startBox, handle, dx, dy, drag.startFontSize));
        } else {
          box = resizeBox(drag.startBox, drag.kind.handle, dx, dy);
        }
        break;
      case "rotate":
        box = rotateBox(
          drag.startBox,
          drag.startPointer,
          { x: drag.startPointer.x + dx, y: drag.startPointer.y + dy },
          event.shiftKey,
        );
        break;
    }
    const page = { width: shown.viewport.width, height: shown.viewport.height };
    const geometry = boxToGeometry(shown.viewport, keepOnPage(box, page));
    callbacks.update(drag.id, fontSize === undefined ? geometry : { ...geometry, fontSize });
  }

  function onPointerEnd(event: PointerEvent): void {
    if (drag && event.pointerId === drag.pointerId) {
      endDrag();
      layout();
    }
  }

  function endDrag(): void {
    if (!drag) return;
    const { target, pointerId } = drag;
    drag = null;
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerEnd);
    target.removeEventListener("pointercancel", onPointerEnd);
    target.removeEventListener("lostpointercapture", onPointerEnd);
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // Nothing to release.
    }
    badge.hidden = true;
  }

  return {
    sync(next) {
      if (next !== state) {
        // Another document (or none): drop everything that belonged to the old one.
        endDrag();
        editor.close();
        state = next;
        for (const img of images.values()) img.remove();
        images.clear();
        for (const span of texts.values()) span.remove();
        texts.clear();
        for (const url of urls.values()) env.revokeObjectURL(url);
        urls.clear();
      }
      layout();
    },
    setShownPage(next) {
      // Interaction maths ran against the old viewport; a new one invalidates it.
      if (next?.viewport !== shown?.viewport || next?.pageIndex !== shown?.pageIndex) endDrag();
      shown = next;
      layout();
    },
  };
}
