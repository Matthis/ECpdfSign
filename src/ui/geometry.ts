// Interaction maths for placed elements, all in viewport space (CSS px of the
// shown page, y grows downwards). A box is described by its center, its
// unrotated size and its rotation (degrees, clockwise on screen, about the
// center). Pure: no DOM. The only bridge to PDF space is `boxToGeometry` /
// `boxFromGeometry`, which go through pdf/viewport.ts.

import { normalizeRotation, type PdfRect } from "../model";
import { toPdfRect, toViewportPoint, toViewportRect, type PageViewport } from "../pdf/viewport";
import { MIN_FONT_SIZE } from "../placeDate/metrics";

export interface Box {
  cx: number;
  cy: number;
  /** Unrotated width (along the element's own x axis). */
  width: number;
  /** Unrotated height (along the element's own y axis). */
  height: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Smallest short side the user can shrink an element to (CSS px). */
export const MIN_SIZE = 16;
/** How much of the rotated bounding box must stay on the page in each direction (CSS px). */
export const KEEP_VISIBLE = 16;
/** Default signature width as a share of the shown page width. */
export const DEFAULT_WIDTH_SHARE = 0.25;
/** Snap distance to 0/90/180/270° (degrees). */
export const SNAP_DEGREES = 3;
/** Rotation step while Shift is held (degrees). */
export const SHIFT_STEP_DEGREES = 15;

export type Corner = "nw" | "ne" | "se" | "sw";
export type Edge = "n" | "e" | "s" | "w";
export type Handle = Corner | Edge;

export const CORNERS: readonly Corner[] = ["nw", "ne", "se", "sw"];
export const EDGES: readonly Edge[] = ["n", "e", "s", "w"];

/** Direction of a handle in the element's local axes (-1, 0 or +1 per axis). */
export const HANDLE_SIGNS: Readonly<Record<Handle, { sx: number; sy: number }>> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
};

export function isCorner(handle: Handle): handle is Corner {
  return handle.length === 2;
}

const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

/** Rotates a vector clockwise on screen (y down) by `degrees`. */
function rotateVector(x: number, y: number, degrees: number): Point {
  const c = Math.cos(toRad(degrees));
  const s = Math.sin(toRad(degrees));
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Screen position of the point (u, v) given in the box's local axes, relative to its center. */
export function boxPoint(box: Box, u: number, v: number): Point {
  const d = rotateVector(u, v, box.rotation);
  return { x: box.cx + d.x, y: box.cy + d.y };
}

/** The four corners on screen, in the order nw, ne, se, sw. */
export function boxCorners(box: Box): Point[] {
  return CORNERS.map((corner) => {
    const { sx, sy } = HANDLE_SIGNS[corner];
    return boxPoint(box, (sx * box.width) / 2, (sy * box.height) / 2);
  });
}

/** Axis-aligned bounds of the rotated box. */
export function rotatedBounds(box: Box): { left: number; top: number; right: number; bottom: number } {
  const c = Math.abs(Math.cos(toRad(box.rotation)));
  const s = Math.abs(Math.sin(toRad(box.rotation)));
  const halfW = (box.width * c + box.height * s) / 2;
  const halfH = (box.width * s + box.height * c) / 2;
  return {
    left: box.cx - halfW,
    top: box.cy - halfH,
    right: box.cx + halfW,
    bottom: box.cy + halfH,
  };
}

export function moveBox(box: Box, dx: number, dy: number): Box {
  return { ...box, cx: box.cx + dx, cy: box.cy + dy };
}

/**
 * Resizes `start` by dragging `handle` by (dx, dy) screen px. The pointer
 * delta is projected onto the element's own axes; the opposite corner (corner
 * handles, aspect ratio kept) or the opposite edge (edge handles, only one
 * dimension changes) keeps its screen position. Neither side can shrink below
 * `minSize`; a box that is already smaller (e.g. after the window shrank) just
 * cannot get smaller still.
 */
export function resizeBox(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  minSize = MIN_SIZE,
): Box {
  const { sx, sy } = HANDLE_SIGNS[handle];
  const local = rotateVector(dx, dy, -start.rotation);
  let width = start.width;
  let height = start.height;

  if (isCorner(handle)) {
    // Project the desired size onto the start size: the scale factor along the diagonal.
    const wantW = start.width + sx * local.x;
    const wantH = start.height + sy * local.y;
    const scale =
      (wantW * start.width + wantH * start.height) /
      (start.width * start.width + start.height * start.height);
    const short = Math.min(start.width, start.height);
    const minScale = Math.min(1, minSize / short);
    const s = Math.max(scale, minScale);
    width = start.width * s;
    height = start.height * s;
  } else if (sx !== 0) {
    width = Math.max(start.width + sx * local.x, Math.min(start.width, minSize));
  } else {
    height = Math.max(start.height + sy * local.y, Math.min(start.height, minSize));
  }

  // The fixed corner/edge midpoint, then the new center measured from it.
  const fixed = boxPoint(start, (-sx * start.width) / 2, (-sy * start.height) / 2);
  const offset = rotateVector((sx * width) / 2, (sy * height) / 2, start.rotation);
  return { ...start, width, height, cx: fixed.x + offset.x, cy: fixed.y + offset.y };
}

/**
 * Shifts the box so that at least `margin` px of its rotated bounding box stay
 * on the page horizontally and vertically (less only if the box itself is
 * smaller than that).
 */
export function keepOnPage(box: Box, page: Size, margin = KEEP_VISIBLE): Box {
  const b = rotatedBounds(box);
  const halfW = (b.right - b.left) / 2;
  const halfH = (b.bottom - b.top) / 2;
  const mx = Math.min(margin, halfW * 2, page.width);
  const my = Math.min(margin, halfH * 2, page.height);
  const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);
  return {
    ...box,
    cx: clamp(box.cx, mx - halfW, page.width - mx + halfW),
    cy: clamp(box.cy, my - halfH, page.height - my + halfH),
  };
}

/** Direction from `center` to `point` in degrees, clockwise on screen, 0° = pointing right. */
export function pointerAngle(center: Point, point: Point): number {
  return toDeg(Math.atan2(point.y - center.y, point.x - center.x));
}

/**
 * Normalizes to [0, 360), then either rounds to `SHIFT_STEP_DEGREES` steps
 * (Shift held) or snaps to 0/90/180/270° when within `SNAP_DEGREES`.
 */
export function snapRotation(degrees: number, shift: boolean): number {
  const r = normalizeRotation(degrees);
  if (shift) return normalizeRotation(Math.round(r / SHIFT_STEP_DEGREES) * SHIFT_STEP_DEGREES);
  const nearest = Math.round(r / 90) * 90;
  return normalizeRotation(Math.abs(r - nearest) <= SNAP_DEGREES ? nearest : r);
}

/**
 * Rotates `start` about its center by the angle the pointer swept around the
 * center since `startPointer`, so grabbing the handle off-center does not jump.
 */
export function rotateBox(start: Box, startPointer: Point, pointer: Point, shift: boolean): Box {
  const center = { x: start.cx, y: start.cy };
  const delta = pointerAngle(center, pointer) - pointerAngle(center, startPointer);
  return { ...start, rotation: snapRotation(start.rotation + delta, shift) };
}

/**
 * A new signature: centered on the page, upright, `DEFAULT_WIDTH_SHARE` of the
 * page width with the image's aspect ratio, enlarged if its short side would
 * be below `MIN_SIZE`.
 */
export function defaultPlacement(page: Size, imageWidth: number, imageHeight: number): Box {
  let width = page.width * DEFAULT_WIDTH_SHARE;
  let height = (width * imageHeight) / imageWidth;
  const short = Math.min(width, height);
  if (short < MIN_SIZE) {
    width *= MIN_SIZE / short;
    height *= MIN_SIZE / short;
  }
  return { cx: page.width / 2, cy: page.height / 2, width, height, rotation: 0 };
}

/**
 * What the model stores for a box: its unrotated rectangle in PDF user space
 * plus the rotation, and for a scaled place/date text its new font size.
 */
export interface ElementGeometry {
  rect: PdfRect;
  rotation: number;
  fontSize?: number;
}

export function boxToGeometry(viewport: PageViewport, box: Box): ElementGeometry {
  return {
    rect: toPdfRect(viewport, {
      left: box.cx - box.width / 2,
      top: box.cy - box.height / 2,
      width: box.width,
      height: box.height,
    }),
    rotation: normalizeRotation(box.rotation),
  };
}

export function boxFromGeometry(viewport: PageViewport, geometry: ElementGeometry): Box {
  const r = toViewportRect(viewport, geometry.rect);
  return {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    width: r.width,
    height: r.height,
    rotation: geometry.rotation,
  };
}

/** Viewport px per PDF user-space unit (the page's zoom, whatever its /Rotate). */
export function pdfUnitInPx(viewport: PageViewport): number {
  const a = toViewportPoint(viewport, { x: 0, y: 0 });
  const b = toViewportPoint(viewport, { x: 1, y: 0 });
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Scales a place/date text by dragging a corner handle by (dx, dy) screen px.
 * Like a corner resize (aspect ratio kept, the opposite corner stays where it
 * is), but the limit is the font size: it never drops below `minFontSize`
 * (a text that is already smaller cannot get smaller still). Returns the new
 * box and font size.
 */
export function scaleTextBox(
  start: Box,
  corner: Corner,
  dx: number,
  dy: number,
  startFontSize: number,
  minFontSize = MIN_FONT_SIZE,
): { box: Box; fontSize: number } {
  const short = Math.min(start.width, start.height);
  // resizeBox stops at minScale = minSize / short; make that minFontSize / startFontSize.
  const box = resizeBox(start, corner, dx, dy, (short * minFontSize) / startFontSize);
  const ratio = start.height > 0 ? box.height / start.height : 1;
  return { box, fontSize: startFontSize * ratio };
}

/**
 * Gives `box` a new size while its own top-left corner (on screen, rotation
 * included) stays put; used when the text of a place/date element changes.
 */
export function resizeFromTopLeft(box: Box, width: number, height: number): Box {
  const nw = boxPoint(box, -box.width / 2, -box.height / 2);
  const d = rotateVector(width / 2, height / 2, box.rotation);
  return { ...box, width, height, cx: nw.x + d.x, cy: nw.y + d.y };
}

/** Gap between a signature and a new place/date text, as a share of the text's height. */
export const PLACE_DATE_GAP_SHARE = 0.25;

/**
 * Where a new place/date text of `size` (viewport px) goes, upright:
 * - below `signature` (its rotated bounding box), left-aligned with it, with a
 *   small gap;
 * - if it does not fit below on the page, to its right, vertically centered;
 * - without a signature, centered on the page.
 * The result is shifted onto the page as far as it fits.
 */
export function placeDatePlacement(page: Size, size: Size, signature: Box | null): Box {
  let left: number;
  let top: number;
  if (!signature) {
    left = (page.width - size.width) / 2;
    top = (page.height - size.height) / 2;
  } else {
    const b = rotatedBounds(signature);
    const gap = size.height * PLACE_DATE_GAP_SHARE;
    if (b.bottom + gap + size.height <= page.height) {
      left = b.left;
      top = b.bottom + gap;
    } else {
      left = b.right + gap;
      top = (b.top + b.bottom) / 2 - size.height / 2;
    }
    const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
    left = clamp(left, page.width - size.width);
    top = clamp(top, page.height - size.height);
  }
  return {
    cx: left + size.width / 2,
    cy: top + size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
  };
}
