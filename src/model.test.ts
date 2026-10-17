import { describe, expect, it } from "vitest";
import {
  addImage,
  addSignature,
  clampPageIndex,
  createDocumentState,
  elementsOnPage,
  getSelectedElement,
  normalizeRotation,
  removeElement,
  selectElement,
  updateElementGeometry,
} from "./model";

describe("document state", () => {
  it("starts on the first page without elements", () => {
    const state = createDocumentState("a.pdf", new Uint8Array([1]), 10);
    expect(state.selectedPageIndex).toBe(0);
    expect(state.elements).toEqual([]);
    expect(state.selectedElementId).toBeNull();
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
