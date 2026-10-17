// Page rendering. Viewports are in CSS pixels; the canvas backing store is
// scaled by devicePixelRatio through the render transform so the page stays
// sharp on HiDPI screens without changing the viewport used for coordinates.

import {
  RenderingCancelledException,
  type PageViewport,
  type PDFPageProxy,
  type RenderTask,
} from "./pdfjs";

/** Upper bound for canvas backing stores (WebKit refuses canvases above ~16.7 MP). */
const MAX_CANVAS_PIXELS = 16_000_000;

/** Viewport whose CSS size fits into `maxWidth` x `maxHeight`, keeping the page aspect ratio. */
export function fitViewport(
  page: PDFPageProxy,
  maxWidth: number,
  maxHeight: number,
): PageViewport {
  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.max(
    Math.min(maxWidth / unscaled.width, maxHeight / unscaled.height),
    0.01,
  );
  return page.getViewport({ scale });
}

export interface PageRender {
  /** Canvas that will hold the page; insert it into the DOM whenever convenient. */
  readonly canvas: HTMLCanvasElement;
  /** Resolves when drawing finished; rejects with `RenderingCancelledException` on cancel. */
  readonly done: Promise<void>;
  cancel(): void;
}

/** Renders `page` at `viewport` (CSS pixels) into a new canvas sized for the current devicePixelRatio. */
export function renderPage(page: PDFPageProxy, viewport: PageViewport): PageRender {
  const canvas = document.createElement("canvas");
  let outputScale = window.devicePixelRatio || 1;
  const cssPixels = viewport.width * viewport.height;
  if (cssPixels * outputScale * outputScale > MAX_CANVAS_PIXELS) {
    outputScale = Math.sqrt(MAX_CANVAS_PIXELS / cssPixels);
  }
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const sx = canvas.width / viewport.width;
  const sy = canvas.height / viewport.height;
  const task: RenderTask = page.render({
    canvas,
    viewport,
    transform: sx !== 1 || sy !== 1 ? [sx, 0, 0, sy, 0, 0] : undefined,
  });
  return { canvas, done: task.promise, cancel: () => task.cancel() };
}

export function isRenderCancelled(error: unknown): boolean {
  return (
    error instanceof RenderingCancelledException ||
    (error as { name?: unknown } | null)?.name === "RenderingCancelledException"
  );
}
