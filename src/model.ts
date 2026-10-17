// Application state that later stories (signatures, place/date texts, save)
// build on. Pure data, no DOM and no pdf.js.

/** A rectangle in PDF user space of one page (origin and y-axis as in the PDF). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlacedElementKind = "signature" | "placeDate";

/**
 * Something placed on a page. Positions are stored in PDF user space and are
 * converted to the screen only through the page viewport (see pdf/viewport.ts).
 */
export interface PlacedElement {
  id: string;
  kind: PlacedElementKind;
  /** 0-based page index. */
  pageIndex: number;
  rect: PdfRect;
}

export interface DocumentState {
  /** File name of the opened PDF, for display only (never a path). */
  sourceName: string;
  /** Original bytes as read from disk; never modified. */
  sourceBytes: Uint8Array;
  pageCount: number;
  /** 0-based index of the page shown large. */
  selectedPageIndex: number;
  elements: PlacedElement[];
}

export function createDocumentState(
  sourceName: string,
  sourceBytes: Uint8Array,
  pageCount: number,
): DocumentState {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new RangeError(`pageCount must be a positive integer, got ${pageCount}`);
  }
  return { sourceName, sourceBytes, pageCount, selectedPageIndex: 0, elements: [] };
}

/** Returns the page index clamped to the document, so callers cannot select a missing page. */
export function clampPageIndex(state: DocumentState, pageIndex: number): number {
  if (!Number.isFinite(pageIndex)) return 0;
  return Math.min(Math.max(Math.trunc(pageIndex), 0), state.pageCount - 1);
}
