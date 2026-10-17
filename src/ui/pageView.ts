// Right-hand page view: the selected page fitted into the available space and
// re-rendered sharply when the window or the devicePixelRatio changes.

import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { fitViewport, isRenderCancelled, renderPage, type PageRender } from "../pdf/render";
import type { PageViewport } from "../pdf/viewport";

export interface ShownPage {
  pageIndex: number;
  /** Viewport of the canvas on screen (CSS px, origin at the canvas' top-left). */
  viewport: PageViewport;
}

export interface PageView {
  setDocument(doc: PDFDocumentProxy | null, pageIndex: number): void;
  showPage(pageIndex: number): void;
  /** The page currently on screen and its viewport, once it has been drawn. */
  getShownPage(): ShownPage | null;
  /**
   * Calls `listener` whenever a page has been drawn with a (possibly new)
   * viewport, and with `null` when nothing usable is shown any more (no
   * document, or the page failed to render). Returns an unsubscribe function.
   */
  onViewportShown(listener: (shown: ShownPage | null) => void): () => void;
}

export function createPageView(
  container: HTMLElement,
  emptyHint: HTMLElement,
  stage: HTMLElement,
): PageView {
  let doc: PDFDocumentProxy | null = null;
  let pageIndex = 0;
  let shown: ShownPage | null = null;
  let renderSeq = 0;
  let activeRender: PageRender | null = null;
  let renderedKey: string | null = null;
  /**
   * The canvas or error message this view put into the stage. Only this node
   * is ever replaced, so other layers in the stage (the element overlay) survive.
   */
  let pageContent: HTMLElement | null = null;
  const listeners = new Set<(shown: ShownPage | null) => void>();

  function notify(): void {
    for (const listener of listeners) listener(shown);
  }

  function setPageContent(node: HTMLElement | null): void {
    if (pageContent !== node) pageContent?.remove();
    pageContent = node;
    if (node) stage.prepend(node);
  }

  function available(): { width: number; height: number } {
    const styles = getComputedStyle(container);
    const px = (value: string) => parseFloat(value) || 0;
    return {
      width: container.clientWidth - px(styles.paddingLeft) - px(styles.paddingRight),
      height: container.clientHeight - px(styles.paddingTop) - px(styles.paddingBottom),
    };
  }

  function showMessage(text: string): void {
    const message = document.createElement("p");
    message.className = "page-error";
    message.textContent = text;
    setPageContent(message);
    stage.style.width = "";
    stage.style.height = "";
  }

  async function render(force: boolean): Promise<void> {
    const currentDoc = doc;
    if (!currentDoc) return;
    const { width, height } = available();
    if (width < 10 || height < 10) return;
    const key = `${pageIndex}:${width}x${height}@${window.devicePixelRatio || 1}`;
    if (!force && key === renderedKey) return;

    const seq = ++renderSeq;
    activeRender?.cancel();
    activeRender = null;
    const index = pageIndex;
    try {
      const page = await currentDoc.getPage(index + 1);
      if (seq !== renderSeq) return;
      const viewport = fitViewport(page, width, height);
      const job = renderPage(page, viewport);
      activeRender = job;
      await job.done;
      if (seq !== renderSeq) return;
      activeRender = null;
      // Swap in the finished canvas so resizing never flashes an empty page.
      setPageContent(job.canvas);
      stage.style.width = `${viewport.width}px`;
      stage.style.height = `${viewport.height}px`;
      shown = { pageIndex: index, viewport };
      renderedKey = key;
      notify();
    } catch (error) {
      if (seq !== renderSeq || isRenderCancelled(error)) return;
      activeRender = null;
      console.error(`Seite ${index + 1} konnte nicht dargestellt werden`, error);
      shown = null;
      renderedKey = key;
      showMessage(`Seite ${index + 1} konnte nicht dargestellt werden.`);
      notify();
    }
  }

  // Re-fit on resize once the size settles.
  let resizeTimer: number | undefined;
  new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void render(false), 100);
  }).observe(container);

  // Moving the window to a screen with another scale factor changes the
  // devicePixelRatio without resizing the element.
  function watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener(
      "change",
      () => {
        watchPixelRatio();
        void render(false);
      },
      { once: true },
    );
  }
  watchPixelRatio();

  return {
    setDocument(newDoc, newPageIndex) {
      renderSeq++;
      activeRender?.cancel();
      activeRender = null;
      doc = newDoc;
      pageIndex = newPageIndex;
      shown = null;
      renderedKey = null;
      setPageContent(null);
      stage.hidden = !newDoc;
      emptyHint.hidden = !!newDoc;
      notify();
      if (newDoc) void render(true);
    },
    showPage(newPageIndex) {
      if (!doc || newPageIndex === pageIndex) return;
      pageIndex = newPageIndex;
      void render(true);
    },
    getShownPage() {
      return shown && shown.pageIndex === pageIndex ? shown : null;
    },
    onViewportShown(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
