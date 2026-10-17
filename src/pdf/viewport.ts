// Screen <-> PDF coordinate conversion. These functions are the only place
// where the two coordinate systems meet; they go exclusively through the pdf.js
// page viewport, which already accounts for /Rotate, the CropBox origin and
// /UserUnit. Never convert with ad-hoc scale math elsewhere.

import type { PageViewport } from "./pdfjs";
import type { PdfRect } from "../model";

export type { PageViewport };

/** A point in viewport space: CSS pixels from the top-left of the rendered page. */
export interface ViewportPoint {
  x: number;
  y: number;
}

/** A point in PDF user space of the page (y grows upwards). */
export interface PdfPoint {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in viewport space (CSS pixels, y grows downwards). */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toPdfPoint(viewport: PageViewport, point: ViewportPoint): PdfPoint {
  const [x, y] = viewport.convertToPdfPoint(point.x, point.y) as [number, number];
  return { x, y };
}

export function toViewportPoint(viewport: PageViewport, point: PdfPoint): ViewportPoint {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y) as [number, number];
  return { x, y };
}

/**
 * Converts a viewport rectangle to PDF user space. Page rotations are multiples
 * of 90 degrees, so an axis-aligned rectangle stays axis-aligned; the corners
 * are converted and re-normalised.
 */
export function toPdfRect(viewport: PageViewport, rect: ViewportRect): PdfRect {
  const a = toPdfPoint(viewport, { x: rect.left, y: rect.top });
  const b = toPdfPoint(viewport, { x: rect.left + rect.width, y: rect.top + rect.height });
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function toViewportRect(viewport: PageViewport, rect: PdfRect): ViewportRect {
  const a = toViewportPoint(viewport, { x: rect.x, y: rect.y });
  const b = toViewportPoint(viewport, { x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
