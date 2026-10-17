import { describe, expect, it } from "vitest";
import { clampPageIndex, createDocumentState } from "./model";

describe("document state", () => {
  it("starts on the first page without elements", () => {
    const state = createDocumentState("a.pdf", new Uint8Array([1]), 10);
    expect(state.selectedPageIndex).toBe(0);
    expect(state.elements).toEqual([]);
    expect(state.pageCount).toBe(10);
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
