// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { renderPage } from "../pdf/render";
import { createThumbnailStrip } from "./thumbnails";

// Rendering is replaced by a fake that immediately "draws" a fresh canvas.
vi.mock("../pdf/render", () => ({
  fitViewport: vi.fn(() => ({ width: 100, height: 140 })),
  renderPage: vi.fn(() => ({
    canvas: document.createElement("canvas"),
    done: Promise.resolve(),
    cancel: vi.fn(),
  })),
  isRenderCancelled: () => false,
}));

/** IntersectionObserver fake whose callback the test fires by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(readonly callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.add(target);
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): [] {
    return [];
  }
  fire(targets: Element[], isIntersecting: boolean): void {
    this.callback(targets.map((target) => ({ target, isIntersecting })));
  }
}

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  // happy-dom has no layout; give every element a box so frames are renderable.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(150);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.mocked(renderPage).mockClear();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeDoc(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    getPage: vi.fn(async (pageNumber: number) => ({ pageNumber })),
  } as unknown as PDFDocumentProxy;
}

function setup() {
  const container = document.createElement("nav");
  document.body.append(container);
  const onSelect = vi.fn();
  const strip = createThumbnailStrip(container, onSelect);
  const thumbs = () => Array.from(container.querySelectorAll<HTMLButtonElement>(".thumb"));
  const selected = () => thumbs().filter((t) => t.classList.contains("selected")).map((t) => t.dataset.index);
  return { container, onSelect, strip, thumbs, selected };
}

describe("thumbnail strip", () => {
  it("matrix: Open normal PDF - one thumbnail per page, page 1 marked", () => {
    const { strip, thumbs, selected } = setup();
    strip.setDocument(fakeDoc(10), 0);
    expect(thumbs()).toHaveLength(10);
    expect(thumbs()[0].getAttribute("aria-label")).toBe("Seite 1");
    expect(selected()).toEqual(["0"]);
    expect(thumbs()[0].getAttribute("aria-current")).toBe("page");
  });

  it("matrix: Select page - clicking thumbnail 7 reports it, and marking moves", () => {
    const { strip, thumbs, selected, onSelect } = setup();
    strip.setDocument(fakeDoc(10), 0);
    thumbs()[6].click();
    expect(onSelect).toHaveBeenCalledWith(6);
    strip.setSelected(6);
    expect(selected()).toEqual(["6"]);
    expect(thumbs()[0].hasAttribute("aria-current")).toBe(false);
  });

  it("matrix: Open another PDF - replaces thumbnails, marks page 1 and scrolls to the top", () => {
    const { container, strip, thumbs, selected } = setup();
    strip.setDocument(fakeDoc(10), 0);
    strip.setSelected(8);
    container.scrollTop = 1500;
    expect(container.scrollTop).toBe(1500); // the DOM keeps the value, so the reset below is real

    strip.setDocument(fakeDoc(3), 0);

    expect(container.scrollTop).toBe(0);
    expect(thumbs()).toHaveLength(3);
    expect(selected()).toEqual(["0"]);
  });

  it("renders only thumbnails that scroll into view and releases those that leave", async () => {
    const { strip, thumbs } = setup();
    const doc = fakeDoc(10);
    strip.setDocument(doc, 0);
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer.observed.size).toBe(10);
    const canvases = () => thumbs().map((t) => t.querySelector(".thumb-frame canvas") !== null);

    // Nothing is rendered until the observer reports visibility.
    await Promise.resolve();
    expect(doc.getPage).not.toHaveBeenCalled();

    observer.fire(thumbs().slice(0, 3), true);
    await vi.waitFor(() => expect(canvases().filter(Boolean)).toHaveLength(3));
    expect(vi.mocked(doc.getPage).mock.calls.map(([n]) => n).sort()).toEqual([1, 2, 3]);
    expect(canvases()).toEqual([true, true, true, false, false, false, false, false, false, false]);
    expect(renderPage).toHaveBeenCalledTimes(3);

    // Thumbnail 1 scrolls far away: its canvas is released.
    observer.fire([thumbs()[0]], false);
    expect(thumbs()[0].querySelector(".thumb-frame")?.childElementCount).toBe(0);
    expect(canvases()[1]).toBe(true);

    // Scrolling further renders the next one on demand.
    observer.fire([thumbs()[7]], true);
    await vi.waitFor(() => expect(canvases()[7]).toBe(true));
    expect(doc.getPage).toHaveBeenLastCalledWith(8);
    expect(doc.getPage).toHaveBeenCalledTimes(4);
  });
});
