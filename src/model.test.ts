import { describe, expect, it } from "vitest";
import {
  addImage,
  addPlaceDate,
  addSignature,
  clampPageIndex,
  createDocumentState,
  elementsOnPage,
  GEOMETRY_TOLERANCE,
  getSelectedElement,
  hasUnsavedChanges,
  markSaved,
  normalizeRotation,
  removeElement,
  selectElement,
  updateElementGeometry,
  updatePlaceDateText,
} from "./model";

describe("document state", () => {
  it("starts on the first page without elements", () => {
    const state = createDocumentState("a.pdf", new Uint8Array([1]), 10);
    expect(state.selectedPageIndex).toBe(0);
    expect(state.elements).toEqual([]);
    expect(state.selectedElementId).toBeNull();
    expect(state.editingElementId).toBeNull();
    expect(state.images.size).toBe(0);
    expect(state.pageCount).toBe(10);
    expect(state.signedSignatureCount).toBe(0);
    expect(state.signatureWarningAccepted).toBe(false);
  });

  it("stores the signed signature count of the opened PDF, not yet accepted", () => {
    const state = createDocumentState("a.pdf", new Uint8Array([1]), 1, 2);
    expect(state.signedSignatureCount).toBe(2);
    expect(state.signatureWarningAccepted).toBe(false);
  });

  it("refuses documents without pages", () => {
    expect(() => createDocumentState("a.pdf", new Uint8Array(), 0)).toThrow(RangeError);
  });

  it("clamps page indices to the document", () => {
    const state = createDocumentState("a.pdf", new Uint8Array(), 10);
    expect(clampPageIndex(state, -1)).toBe(0);
    expect(clampPageIndex(state, 6)).toBe(6);
    expect(clampPageIndex(state, 10)).toBe(9);
    expect(clampPageIndex(state, Number.NaN)).toBe(0);
  });
});

const RECT = { x: 10, y: 20, width: 100, height: 40 };

function withImage(pages = 5) {
  const state = createDocumentState("a.pdf", new Uint8Array(), pages);
  const imageId = addImage(state, new Uint8Array([1, 2, 3]), 30, 10);
  return { state, imageId };
}

describe("images", () => {
  it("stores byte-identical PNGs once", () => {
    const state = createDocumentState("a.pdf", new Uint8Array(), 1);
    const a = addImage(state, new Uint8Array([1, 2, 3]), 3, 1);
    const b = addImage(state, new Uint8Array([1, 2, 3]), 3, 1);
    const c = addImage(state, new Uint8Array([1, 2, 4]), 3, 1);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(state.images.size).toBe(2);
  });

  it("keeps its own copy of the bytes", () => {
    const state = createDocumentState("a.pdf", new Uint8Array(), 1);
    const bytes = new Uint8Array([9, 9]);
    const id = addImage(state, bytes, 1, 1);
    bytes[0] = 0;
    expect(state.images.get(id)?.bytes).toEqual(new Uint8Array([9, 9]));
  });
});

describe("elements", () => {
  it("adds signatures with unique ids, rotation and image", () => {
    const { state, imageId } = withImage();
    const a = addSignature(state, { pageIndex: 2, rect: RECT, rotation: 0, imageId });
    const b = addSignature(state, { pageIndex: 2, rect: RECT, rotation: -90, imageId });
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ kind: "signature", pageIndex: 2, rect: RECT, rotation: 0, imageId });
    expect(b.rotation).toBe(270);
    expect(state.elements).toEqual([a, b]);
  });

  it("refuses unknown images", () => {
    const { state } = withImage();
    expect(() => addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId: "x" })).toThrow();
  });

  it("lists elements by page in drawing order", () => {
    const { state, imageId } = withImage();
    const a = addSignature(state, { pageIndex: 1, rect: RECT, rotation: 0, imageId });
    addSignature(state, { pageIndex: 4, rect: RECT, rotation: 0, imageId });
    const c = addSignature(state, { pageIndex: 1, rect: RECT, rotation: 0, imageId });
    expect(elementsOnPage(state, 1)).toEqual([a, c]);
    expect(elementsOnPage(state, 0)).toEqual([]);
  });

  it("updates geometry and normalizes the rotation", () => {
    const { state, imageId } = withImage();
    const a = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(updateElementGeometry(state, a.id, rect, 370)).toBe(true);
    expect(a.rect).toEqual(rect);
    expect(a.rect).not.toBe(rect);
    expect(a.rotation).toBe(10);
    expect(updateElementGeometry(state, "nope", rect, 0)).toBe(false);
  });

  it("selects known elements only", () => {
    const { state, imageId } = withImage();
    const a = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    selectElement(state, a.id);
    expect(getSelectedElement(state)).toBe(a);
    selectElement(state, "nope");
    expect(state.selectedElementId).toBeNull();
    selectElement(state, a.id);
    selectElement(state, null);
    expect(getSelectedElement(state)).toBeUndefined();
  });

  it("removes an element, its selection and its image once unused", () => {
    const { state, imageId } = withImage();
    const a = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const b = addSignature(state, { pageIndex: 3, rect: RECT, rotation: 0, imageId });
    selectElement(state, a.id);

    expect(removeElement(state, a.id)).toBe(true);
    expect(state.elements).toEqual([b]);
    expect(state.selectedElementId).toBeNull();
    expect(state.images.has(imageId)).toBe(true); // still used by b

    expect(removeElement(state, b.id)).toBe(true);
    expect(state.images.size).toBe(0);
    expect(removeElement(state, b.id)).toBe(false);
  });

  it("keeps the selection when another element is removed", () => {
    const { state, imageId } = withImage();
    const a = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const b = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    selectElement(state, a.id);
    removeElement(state, b.id);
    expect(state.selectedElementId).toBe(a.id);
  });
});

describe("place/date texts", () => {
  const TEXT = { pageIndex: 1, rect: RECT, rotation: 0, place: "", date: "17.10.2026", fontSize: 11 };

  it("adds a text with place, date, font size and rotation", () => {
    const state = createDocumentState("a.pdf", new Uint8Array(), 3);
    const a = addPlaceDate(state, { ...TEXT, rotation: -30 });
    expect(a).toMatchObject({ kind: "placeDate", pageIndex: 1, place: "", date: "17.10.2026", fontSize: 11 });
    expect(a.rotation).toBe(330);
    expect(a.rect).toEqual(RECT);
    expect(a.rect).not.toBe(RECT);
    expect(state.elements).toEqual([a]);
  });

  it("updates the text together with its box, for texts only", () => {
    const { state, imageId } = withImage();
    const a = addPlaceDate(state, TEXT);
    const sig = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const rect = { x: 5, y: 6, width: 70, height: 15 };
    expect(updatePlaceDateText(state, a.id, "München", "01.11.2026", rect)).toBe(true);
    expect(a).toMatchObject({ place: "München", date: "01.11.2026", rect });
    expect(updatePlaceDateText(state, sig.id, "x", "y", rect)).toBe(false);
    expect(updatePlaceDateText(state, "nope", "x", "y", rect)).toBe(false);
  });

  it("changes the font size with the geometry, but never a signature's", () => {
    const { state, imageId } = withImage();
    const a = addPlaceDate(state, TEXT);
    const sig = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const rect = { x: 1, y: 2, width: 30, height: 8 };
    expect(updateElementGeometry(state, a.id, rect, 15, 22)).toBe(true);
    expect(a).toMatchObject({ rect, rotation: 15, fontSize: 22 });
    updateElementGeometry(state, a.id, rect, 20);
    expect(a.fontSize).toBe(22);
    updateElementGeometry(state, sig.id, rect, 0, 40);
    expect(sig).not.toHaveProperty("fontSize");
  });

  it("ends editing when the edited text is removed", () => {
    const state = createDocumentState("a.pdf", new Uint8Array(), 3);
    const a = addPlaceDate(state, TEXT);
    const b = addPlaceDate(state, TEXT);
    state.editingElementId = a.id;
    removeElement(state, b.id);
    expect(state.editingElementId).toBe(a.id);
    removeElement(state, a.id);
    expect(state.editingElementId).toBeNull();
  });
});

describe("unsaved changes", () => {
  const TEXT = { pageIndex: 0, rect: RECT, rotation: 0, place: "", date: "17.10.2026", fontSize: 11 };

  it("starts without unsaved changes", () => {
    const state = createDocumentState("a.pdf", new Uint8Array(), 3);
    expect(state.revision).toBe(0);
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("counts every element change: insert, move/resize/rotate, font size, text edit, remove", () => {
    const { state, imageId } = withImage();
    const steps: Array<() => unknown> = [];
    const sig = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    steps.push(() => addPlaceDate(state, TEXT));
    steps.push(() => updateElementGeometry(state, sig.id, { ...RECT, x: 11 }, 0)); // move
    steps.push(() => updateElementGeometry(state, sig.id, { ...RECT, x: 11, width: 90 }, 0)); // resize
    steps.push(() => updateElementGeometry(state, sig.id, { ...RECT, x: 11, width: 90 }, 30)); // rotate
    steps.push(() => updateElementGeometry(state, state.elements[1].id, RECT, 0, 14)); // font size
    steps.push(() => updatePlaceDateText(state, state.elements[1].id, "Berlin", "", RECT));
    steps.push(() => removeElement(state, sig.id));
    for (const step of steps) {
      markSaved(state, state.revision);
      expect(hasUnsavedChanges(state)).toBe(false);
      step();
      expect(hasUnsavedChanges(state), String(step)).toBe(true);
    }
  });

  it("does not count selection, page changes, editing state or unchanged geometry", () => {
    const { state, imageId } = withImage();
    const sig = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 30, imageId });
    const text = addPlaceDate(state, TEXT);
    markSaved(state, state.revision);
    const revision = state.revision;
    selectElement(state, sig.id);
    selectElement(state, null);
    state.selectedPageIndex = 2;
    state.editingElementId = text.id;
    updateElementGeometry(state, sig.id, { ...RECT }, 390); // same rect, 390° = 30°
    updateElementGeometry(state, text.id, { ...RECT }, 0, 11);
    updatePlaceDateText(state, text.id, "", "17.10.2026", { ...RECT });
    // Failed mutations change nothing either.
    updateElementGeometry(state, "nope", RECT, 10);
    removeElement(state, "nope");
    expect(state.revision).toBe(revision);
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("ignores float noise below the tolerance, but counts a real change", () => {
    const { state, imageId } = withImage();
    const sig = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const text = addPlaceDate(state, TEXT);
    const revision = state.revision;
    const noise = GEOMETRY_TOLERANCE / 2;
    const noisy = { x: RECT.x + noise, y: RECT.y - noise, width: RECT.width + noise, height: RECT.height };
    updateElementGeometry(state, sig.id, noisy, 360 - noise); // across the 0/360 wrap
    updateElementGeometry(state, text.id, noisy, noise, 11 + noise);
    updatePlaceDateText(state, text.id, "", "17.10.2026", noisy);
    expect(state.revision).toBe(revision);
    // Nothing written either, so noise cannot add up to a change.
    expect(sig.rect).toEqual(RECT);
    expect(sig.rotation).toBe(0);
    expect(text.fontSize).toBe(11);

    for (const step of [
      () => updateElementGeometry(state, sig.id, { ...RECT, x: RECT.x + 1e-3 }, 0),
      () => updateElementGeometry(state, sig.id, { ...RECT, x: RECT.x + 1e-3 }, 1e-3),
      () => updateElementGeometry(state, text.id, RECT, 0, 11 + 1e-3),
      () => updatePlaceDateText(state, text.id, "", "17.10.2026", { ...RECT, y: RECT.y + 1e-3 }),
    ]) {
      const before = state.revision;
      step();
      expect(state.revision, String(step)).toBe(before + 1);
    }
  });

  it("stays unsaved when saved at an older revision", () => {
    const { state, imageId } = withImage();
    const sig = addSignature(state, { pageIndex: 0, rect: RECT, rotation: 0, imageId });
    const snapshot = state.revision;
    updateElementGeometry(state, sig.id, { ...RECT, y: 99 }, 0); // changed while saving
    markSaved(state, snapshot);
    expect(hasUnsavedChanges(state)).toBe(true);
  });
});

describe("normalizeRotation", () => {
  it("maps any angle to [0, 360)", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-0)).toBe(0);
    expect(normalizeRotation(-30)).toBe(330);
    expect(normalizeRotation(725)).toBe(5);
    expect(normalizeRotation(-1e-14)).toBe(0);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });
});
