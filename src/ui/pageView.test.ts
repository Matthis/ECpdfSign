// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { renderPage } from "../pdf/render";
import { createPageView } from "./pageView";

interface FakeJob {
  canvas: HTMLCanvasElement;
  done: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
  finish(): void;
}

/** Every render started by the view, in order; the test decides when each one finishes. */
const jobs: FakeJob[] = [];

vi.mock("../pdf/render", () => ({
  fitViewport: vi.fn(() => ({ width: 300, height: 400 })),
  renderPage: vi.fn(() => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const job = { canvas: document.createElement("canvas"), done, cancel: vi.fn(), finish };
    jobs.push(job);
    return job;
  }),
  isRenderCancelled: () => false,
}));

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  jobs.length = 0;
  vi.mocked(renderPage).mockClear();
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));
  // happy-dom has no layout; give the page area a size.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
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
  const container = document.createElement("section");
  const hint = document.createElement("p");
  const stage = document.createElement("div");
  stage.hidden = true;
  container.append(hint, stage);
  document.body.append(container);
  const view = createPageView(container, hint, stage);
  return { view, hint, stage };
}

/** Waits until the view has started `count` renders. */
async function rendersStarted(count: number): Promise<void> {
  await vi.waitFor(() => expect(jobs).toHaveLength(count));
}

describe("page view", () => {
  it("shows the hint without a document and the page stage with one", async () => {
    const { view, hint, stage } = setup();
    view.setDocument(null, 0);
    expect(hint.hidden).toBe(false);
    expect(stage.hidden).toBe(true);
    expect(renderPage).not.toHaveBeenCalled();

    view.setDocument(fakeDoc(3), 0);
    expect(hint.hidden).toBe(true);
    expect(stage.hidden).toBe(false);

    await rendersStarted(1);
    jobs[0].finish();
    await vi.waitFor(() => expect(stage.firstElementChild).toBe(jobs[0].canvas));
    expect(view.getShownPage()?.pageIndex).toBe(0);

    view.setDocument(null, 0);
    expect(hint.hidden).toBe(false);
    expect(stage.hidden).toBe(true);
  });

  it("showPage(n) renders page n + 1 of the document", async () => {
    const { view } = setup();
    const doc = fakeDoc(10);
    view.setDocument(doc, 0);
    await rendersStarted(1);
    expect(doc.getPage).toHaveBeenLastCalledWith(1);

    view.showPage(6);
    await rendersStarted(2);
    expect(doc.getPage).toHaveBeenLastCalledWith(7);
  });

  it("never shows an older page when renders finish out of order", async () => {
    const { view, stage } = setup();
    view.setDocument(fakeDoc(10), 0);
    await rendersStarted(1);
    jobs[0].finish();
    await vi.waitFor(() => expect(stage.firstElementChild).toBe(jobs[0].canvas));

    view.showPage(1);
    await rendersStarted(2);
    view.showPage(2);
    await rendersStarted(3);
    const [, older, newer] = jobs;
    expect(older.cancel).toHaveBeenCalled();

    newer.finish();
    await vi.waitFor(() => expect(stage.firstElementChild).toBe(newer.canvas));
    older.finish(); // e.g. a render that completed despite being cancelled
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stage.firstElementChild).toBe(newer.canvas);
    expect(stage.contains(older.canvas)).toBe(false);
    expect(view.getShownPage()?.pageIndex).toBe(2);
  });
});
