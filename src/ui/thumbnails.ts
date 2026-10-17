// Left page strip: one slot per page, sized so about three are visible.
// Thumbnails render lazily when they scroll near the visible area and are
// released again when they scroll far away, so 200-page documents stay cheap.

import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { fitViewport, isRenderCancelled, renderPage, type PageRender } from "../pdf/render";
import { thumbnailSlotHeight } from "./layout";

/** Thumbnails rendered at the same time; keeps the worker free for the main page. */
const MAX_CONCURRENT_RENDERS = 2;

interface Thumb {
  index: number;
  button: HTMLButtonElement;
  frame: HTMLElement;
  near: boolean;
  /** True while a render for this thumbnail is queued in the worker. */
  busy: boolean;
  /** Size key of the canvas currently shown, or null if none/stale. */
  renderedKey: string | null;
  render: PageRender | null;
}

export interface ThumbnailStrip {
  /** Replaces the document (or clears it with `null`) and scrolls to the top. */
  setDocument(doc: PDFDocumentProxy | null, selectedIndex: number): void;
  setSelected(index: number): void;
}

export function createThumbnailStrip(
  container: HTMLElement,
  onSelect: (index: number) => void,
): ThumbnailStrip {
  const list = document.createElement("ol");
  list.className = "thumb-list";
  container.append(list);

  let doc: PDFDocumentProxy | null = null;
  let generation = 0;
  let thumbs: Thumb[] = [];
  let selected = -1;
  const queue: Thumb[] = [];
  let running = 0;

  function sizeKey(frame: HTMLElement): string | null {
    const { clientWidth: w, clientHeight: h } = frame;
    if (w < 2 || h < 2) return null;
    return `${w}x${h}@${window.devicePixelRatio || 1}`;
  }

  function releaseThumb(thumb: Thumb): void {
    thumb.render?.cancel();
    thumb.render = null;
    thumb.renderedKey = null;
    thumb.frame.replaceChildren();
  }

  function enqueue(thumb: Thumb): void {
    if (!queue.includes(thumb)) queue.push(thumb);
    pump();
  }

  function pump(): void {
    while (running < MAX_CONCURRENT_RENDERS && queue.length > 0) {
      const thumb = queue.shift()!;
      if (!thumb.near || thumb.busy) continue;
      const key = sizeKey(thumb.frame);
      if (key === null || key === thumb.renderedKey) continue;
      running++;
      thumb.busy = true;
      const gen = generation;
      void renderThumb(thumb, key, gen).finally(() => {
        running--;
        thumb.busy = false;
        // The strip may have been resized while this render was running.
        if (gen === generation && thumb.near && sizeKey(thumb.frame) !== thumb.renderedKey) {
          queue.push(thumb);
        }
        pump();
      });
    }
  }

  async function renderThumb(thumb: Thumb, key: string, gen: number): Promise<void> {
    const currentDoc = doc;
    if (!currentDoc) return;
    try {
      const page = await currentDoc.getPage(thumb.index + 1);
      if (gen !== generation || !thumb.near) return;
      const viewport = fitViewport(page, thumb.frame.clientWidth, thumb.frame.clientHeight);
      const render = renderPage(page, viewport);
      thumb.render = render;
      try {
        await render.done;
      } finally {
        if (thumb.render === render) thumb.render = null;
      }
      if (gen !== generation || !thumb.near) return;
      thumb.frame.replaceChildren(render.canvas);
      thumb.renderedKey = key;
    } catch (error) {
      if (gen !== generation || isRenderCancelled(error)) return;
      console.error(`Vorschau für Seite ${thumb.index + 1} fehlgeschlagen`, error);
      const failed = document.createElement("span");
      failed.className = "thumb-error";
      failed.textContent = "Vorschau nicht verfügbar";
      thumb.frame.replaceChildren(failed);
      thumb.renderedKey = key;
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const thumb = thumbs[Number((entry.target as HTMLElement).dataset.index)];
        if (!thumb || thumb.button !== entry.target) continue;
        thumb.near = entry.isIntersecting;
        if (thumb.near) enqueue(thumb);
        else releaseThumb(thumb);
      }
    },
    // Render one screen ahead in both directions; release beyond that.
    { root: container, rootMargin: "100% 0px" },
  );

  function updateSlotHeight(): void {
    const styles = getComputedStyle(container);
    const slot = thumbnailSlotHeight({
      containerHeight: container.clientHeight,
      paddingTop: parseFloat(styles.paddingTop) || 0,
      paddingBottom: parseFloat(styles.paddingBottom) || 0,
      gap: parseFloat(getComputedStyle(list).rowGap) || 0,
    });
    container.style.setProperty("--thumb-slot-height", `${slot}px`);
  }

  let resizeTimer: number | undefined;
  const resizeObserver = new ResizeObserver(() => {
    updateSlotHeight();
    // Re-render nearby thumbnails at the new size once resizing settles.
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      for (const thumb of thumbs) if (thumb.near) enqueue(thumb);
    }, 150);
  });
  resizeObserver.observe(container);
  updateSlotHeight();

  function markSelected(index: number): void {
    thumbs[selected]?.button.classList.remove("selected");
    thumbs[selected]?.button.removeAttribute("aria-current");
    selected = index;
    const thumb = thumbs[index];
    if (thumb) {
      thumb.button.classList.add("selected");
      thumb.button.setAttribute("aria-current", "page");
    }
  }

  container.addEventListener("keydown", (event) => {
    if (thumbs.length === 0) return;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "PageDown") next = selected + 1;
    else if (event.key === "ArrowUp" || event.key === "PageUp") next = selected - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = thumbs.length - 1;
    if (next === null) return;
    event.preventDefault();
    next = Math.min(Math.max(next, 0), thumbs.length - 1);
    if (next === selected) return;
    thumbs[next].button.focus({ preventScroll: true });
    thumbs[next].button.scrollIntoView({ block: "nearest" });
    onSelect(next);
  });

  return {
    setDocument(newDoc, selectedIndex) {
      generation++;
      observer.disconnect();
      queue.length = 0;
      for (const thumb of thumbs) thumb.render?.cancel();
      thumbs = [];
      selected = -1;
      list.replaceChildren();
      container.scrollTop = 0;
      doc = newDoc;
      if (!newDoc) return;

      const fragment = document.createDocumentFragment();
      for (let index = 0; index < newDoc.numPages; index++) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "thumb";
        button.dataset.index = String(index);
        button.setAttribute("aria-label", `Seite ${index + 1}`);
        const frame = document.createElement("span");
        frame.className = "thumb-frame";
        const label = document.createElement("span");
        label.className = "thumb-label";
        label.textContent = String(index + 1);
        button.append(frame, label);
        button.addEventListener("click", () => onSelect(index));
        item.append(button);
        fragment.append(item);
        thumbs.push({ index, button, frame, near: false, busy: false, renderedKey: null, render: null });
      }
      list.append(fragment);
      for (const thumb of thumbs) observer.observe(thumb.button);
      markSelected(selectedIndex);
    },
    setSelected(index) {
      markSelected(index);
    },
  };
}
