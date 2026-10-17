// Application state that later stories (signatures, place/date texts, save)
// build on. Pure data, no DOM and no pdf.js. The helpers below change the
// state object they are given and nothing else.

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
interface PlacedElementBase {
  id: string;
  kind: PlacedElementKind;
  /** 0-based page index. */
  pageIndex: number;
  /**
   * The element's box before its own rotation, in PDF user space. On a page
   * with /Rotate this is the PDF rectangle that the upright on-screen box maps
   * to, so its width runs along the screen's vertical axis on 90°/270° pages.
   */
  rect: PdfRect;
  /**
   * Degrees in [0, 360), clockwise as seen on the displayed page, about the
   * center of `rect`. 0° is upright relative to the displayed page.
   */
  rotation: number;
}

export interface SignatureElement extends PlacedElementBase {
  kind: "signature";
  /** Key into `DocumentState.images`. */
  imageId: string;
}

/** Place/date text (story 5); declared so the union is already in place. */
export interface PlaceDateElement extends PlacedElementBase {
  kind: "placeDate";
}

export type PlacedElement = SignatureElement | PlaceDateElement;

/** A PNG used by one or more signatures. Byte-identical files are stored once. */
export interface StoredImage {
  id: string;
  bytes: Uint8Array;
  /** Pixel size from IHDR. */
  width: number;
  height: number;
}

export interface DocumentState {
  /** File name of the opened PDF, for display only (never a path). */
  sourceName: string;
  /** Original bytes as read from disk; never modified. */
  sourceBytes: Uint8Array;
  pageCount: number;
  /** 0-based index of the page shown large. */
  selectedPageIndex: number;
  /** In insertion order (later elements are drawn on top). */
  elements: PlacedElement[];
  /** Id of the selected element, or `null`. */
  selectedElementId: string | null;
  images: Map<string, StoredImage>;
  /** Counter behind element and image ids; ids are never reused within a document. */
  nextId: number;
  /**
   * Signed signature fields found when the PDF was opened. Saving rewrites
   * the file and invalidates them, so the user is warned first.
   */
  signedSignatureCount: number;
  /**
   * Whether the user chose "Trotzdem speichern" for this document. It is not
   * asked again until another document (or the same file again) is opened.
   */
  signatureWarningAccepted: boolean;
}

export function createDocumentState(
  sourceName: string,
  sourceBytes: Uint8Array,
  pageCount: number,
  signedSignatureCount = 0,
): DocumentState {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new RangeError(`pageCount must be a positive integer, got ${pageCount}`);
  }
  return {
    sourceName,
    sourceBytes,
    pageCount,
    selectedPageIndex: 0,
    elements: [],
    selectedElementId: null,
    images: new Map(),
    nextId: 1,
    signedSignatureCount,
    signatureWarningAccepted: false,
  };
}

/** Returns the page index clamped to the document, so callers cannot select a missing page. */
export function clampPageIndex(state: DocumentState, pageIndex: number): number {
  if (!Number.isFinite(pageIndex)) return 0;
  return Math.min(Math.max(Math.trunc(pageIndex), 0), state.pageCount - 1);
}

/** Normalizes an angle in degrees to [0, 360). */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const r = ((degrees % 360) + 360) % 360;
  // -0 and values that round up to 360 (e.g. -1e-14) both become 0.
  return r === 0 || r >= 360 ? 0 : r;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Stores a PNG and returns its id. Byte-identical PNGs share one entry, so the
 * saved PDF embeds each image once. The bytes are copied.
 */
export function addImage(
  state: DocumentState,
  bytes: Uint8Array,
  width: number,
  height: number,
): string {
  for (const image of state.images.values()) {
    if (bytesEqual(image.bytes, bytes)) return image.id;
  }
  const id = `img-${state.nextId++}`;
  state.images.set(id, { id, bytes: bytes.slice(), width, height });
  return id;
}

export interface NewSignature {
  pageIndex: number;
  rect: PdfRect;
  rotation: number;
  imageId: string;
}

/** Adds a signature on top of the others and returns it. */
export function addSignature(state: DocumentState, init: NewSignature): SignatureElement {
  if (!state.images.has(init.imageId)) throw new Error(`unknown image ${init.imageId}`);
  const element: SignatureElement = {
    id: `el-${state.nextId++}`,
    kind: "signature",
    pageIndex: clampPageIndex(state, init.pageIndex),
    rect: { ...init.rect },
    rotation: normalizeRotation(init.rotation),
    imageId: init.imageId,
  };
  state.elements.push(element);
  return element;
}

export function getElement(state: DocumentState, id: string): PlacedElement | undefined {
  return state.elements.find((element) => element.id === id);
}

/** Updates the geometry of an element. Returns `false` if it does not exist. */
export function updateElementGeometry(
  state: DocumentState,
  id: string,
  rect: PdfRect,
  rotation: number,
): boolean {
  const element = getElement(state, id);
  if (!element) return false;
  element.rect = { ...rect };
  element.rotation = normalizeRotation(rotation);
  return true;
}

/**
 * Removes an element, clears the selection if it was selected and drops its
 * image once no other signature uses it. Returns `false` if it did not exist.
 */
export function removeElement(state: DocumentState, id: string): boolean {
  const index = state.elements.findIndex((element) => element.id === id);
  if (index < 0) return false;
  const [removed] = state.elements.splice(index, 1);
  if (state.selectedElementId === id) state.selectedElementId = null;
  if (
    removed.kind === "signature" &&
    !state.elements.some((e) => e.kind === "signature" && e.imageId === removed.imageId)
  ) {
    state.images.delete(removed.imageId);
  }
  return true;
}

/** Selects an element (or nothing with `null`). Unknown ids select nothing. */
export function selectElement(state: DocumentState, id: string | null): void {
  state.selectedElementId = id !== null && getElement(state, id) ? id : null;
}

export function getSelectedElement(state: DocumentState): PlacedElement | undefined {
  return state.selectedElementId === null ? undefined : getElement(state, state.selectedElementId);
}

/** Elements of one page, bottom to top. */
export function elementsOnPage(state: DocumentState, pageIndex: number): PlacedElement[] {
  return state.elements.filter((element) => element.pageIndex === pageIndex);
}
