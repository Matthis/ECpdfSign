// Interaction maths for placed elements, all in viewport space (CSS px of the
// shown page, y grows downwards). A box is described by its center, its
// unrotated size and its rotation (degrees, clockwise on screen, about the
// center). Pure: no DOM. The only bridge to PDF space is `boxToGeometry` /
// `boxFromGeometry`, which go through pdf/viewport.ts.

import { normalizeRotation, type PdfRect } from "../model";
import { toPdfRect, toViewportRect, type PageViewport } from "../pdf/viewport";

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

/** What the model stores for a box: its unrotated rectangle in PDF user space plus the rotation. */
export interface ElementGeometry {
  rect: PdfRect;
  rotation: number;
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
