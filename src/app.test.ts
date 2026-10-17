// I/O & edge-case matrix of story 1, exercised through the app flow with fake
// backend/views and the real PDF loader (pdf.js + pdf-lib in Node).

import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, MESSAGES, type AppDeps } from "./app";
import type { OpenedPdf } from "./backend";
import { loadPdfDocument, type LoadedPdf } from "./pdf/document";
import { OWNER_PASSWORD_ONLY_PDF, USER_PASSWORD_PDF } from "./pdf/encryptedFixtures.test-data";
import { makePng } from "./signature/pngFixtures.test-data";
import type { ShownPage } from "./ui/pageView";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  return doc.save();
}

interface TrackedPdf {
  pdf: LoadedPdf;
  destroy: ReturnType<typeof vi.fn>;
}

/** Every document loaded by a test, destroyed afterwards to free pdf.js resources. */
const opened: LoadedPdf[] = [];

afterEach(async () => {
  for (const pdf of opened.splice(0)) await pdf.destroy().catch(() => undefined);
});

function setup() {
  const picks: Array<OpenedPdf | null> = [];
  const pngPicks: Array<Uint8Array | null> = [];
  const loaded: TrackedPdf[] = [];
  const deps = {
    pickPdf: vi.fn(async () => picks.shift() ?? null),
    acceptOpenedPdf: vi.fn(async () => undefined),
    loadPdfDocument: vi.fn(async (bytes: Uint8Array) => {
      const real = await loadPdfDocument(bytes);
      opened.push(real);
      const destroy = vi.fn(() => real.destroy());
      const tracked = { pdf: { ...real, destroy }, destroy };
      loaded.push(tracked);
      return tracked.pdf;
    }),
    pickSignaturePng: vi.fn(async () => pngPicks.shift() ?? null),
    decodePng: vi.fn(async (_bytes: Uint8Array) => undefined),
    confirmDiscard: vi.fn(async () => true),
    toolbar: { setEnabled: vi.fn(), setDocumentName: vi.fn() },
    pageView: {
      setDocument: vi.fn(),
      showPage: vi.fn(),
      getShownPage: vi.fn((): ShownPage | null => null),
    },
    thumbnails: { setDocument: vi.fn(), setSelected: vi.fn() },
    overlay: { sync: vi.fn() },
    messages: { show: vi.fn(), hide: vi.fn() },
    setBusy: vi.fn(),
    log: { error: vi.fn(), warn: vi.fn() },
  } satisfies AppDeps;
  const app = createApp(deps);

  async function open(name: string, bytes: Uint8Array | null): Promise<void> {
    picks.push(bytes ? { name, bytes } : null);
    await app.openPdf();
  }

  async function insert(bytes: Uint8Array | null): Promise<void> {
    pngPicks.push(bytes);
    await app.insertSignature();
  }

  /** Whether the toolbar button was last set to enabled. */
  function enabled(action: string): boolean | undefined {
    const calls = deps.toolbar.setEnabled.mock.calls.filter(([a]) => a === action);
    return calls.at(-1)?.[1];
  }

  return { app, deps, loaded, open, insert, enabled };
}

/** Clears call records so a test can assert what one action did. */
function clearCalls(deps: ReturnType<typeof setup>["deps"]): void {
  for (const group of [deps.toolbar, deps.pageView, deps.thumbnails, deps.messages, deps.overlay]) {
    for (const fn of Object.values(group)) fn.mockClear();
  }
  deps.acceptOpenedPdf.mockClear();
  deps.loadPdfDocument.mockClear();
}

const NOT_A_PDF = new TextEncoder().encode("Das ist keine PDF-Datei, nur Text.\n".repeat(10));

describe("German messages", () => {
  it("are German and distinguish encrypted from unreadable files", () => {
    expect(MESSAGES.encrypted).toBe(
      "Passwortgeschützte oder verschlüsselte PDF-Dateien werden noch nicht unterstützt.",
    );
    expect(MESSAGES.invalid).toBe("Die Datei konnte nicht als PDF geöffnet werden.");
  });
});

describe("matrix: Open normal PDF", () => {
  it("shows all pages in the strip and page 1 large, marked as selected", async () => {
    const { app, deps, loaded, open } = setup();
    await open("zehn.pdf", await makePdf(10));

    const doc = app.getDocument();
    expect(doc?.state.pageCount).toBe(10);
    expect(doc?.state.selectedPageIndex).toBe(0);
    expect(doc?.state.sourceName).toBe("zehn.pdf");
    const proxy = loaded[0].pdf.proxy;
    expect(proxy.numPages).toBe(10);
    expect(deps.thumbnails.setDocument).toHaveBeenCalledWith(proxy, 0);
    expect(deps.pageView.setDocument).toHaveBeenCalledWith(proxy, 0);
    expect(deps.toolbar.setDocumentName).toHaveBeenCalledWith("zehn.pdf");
    expect(deps.acceptOpenedPdf).toHaveBeenCalledTimes(1);
    expect(deps.messages.show).not.toHaveBeenCalled();
  });

  it("disables 'PDF Öffnen' while opening and ignores a second click meanwhile", async () => {
    const { app, deps } = setup();
    let release!: (value: OpenedPdf | null) => void;
    deps.pickPdf.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const first = app.openPdf();
    expect(deps.toolbar.setEnabled).toHaveBeenLastCalledWith("open", false);
    await app.openPdf(); // ignored while the dialog is open
    expect(deps.pickPdf).toHaveBeenCalledTimes(1);

    release(null);
    await first;
    expect(deps.toolbar.setEnabled).toHaveBeenLastCalledWith("open", true);
    expect(deps.setBusy).toHaveBeenLastCalledWith(false);
  });
});

describe("toolbar actions", () => {
  it("'open' starts the open flow exactly once", async () => {
    const { app, deps } = setup();
    app.handleToolbarAction("open");
    await vi.waitFor(() => expect(deps.toolbar.setEnabled).toHaveBeenLastCalledWith("open", true));
    expect(deps.pickPdf).toHaveBeenCalledTimes(1);
  });

  it("without a document the other actions do nothing", () => {
    const { app, deps } = setup();
    for (const action of ["insertPlaceDate", "insertSignature", "removeElement", "save"] as const) {
      app.handleToolbarAction(action);
    }
    expect(deps.pickPdf).not.toHaveBeenCalled();
    expect(deps.pickSignaturePng).not.toHaveBeenCalled();
    expect(deps.confirmDiscard).not.toHaveBeenCalled();
  });
});

describe("matrix: Select page", () => {
  it("shows the clicked page on the right and marks its thumbnail", async () => {
    const { app, deps, open } = setup();
    await open("zehn.pdf", await makePdf(10));
    clearCalls(deps);

    app.selectPage(6); // thumbnail 7

    expect(app.getDocument()?.state.selectedPageIndex).toBe(6);
    expect(deps.thumbnails.setSelected).toHaveBeenCalledWith(6);
    expect(deps.pageView.showPage).toHaveBeenCalledWith(6);
  });

  it("clamps out-of-range pages and does nothing without a document", async () => {
    const empty = setup();
    empty.app.selectPage(3);
    expect(empty.deps.pageView.showPage).not.toHaveBeenCalled();

    const { app, deps, open } = setup();
    await open("drei.pdf", await makePdf(3));
    app.selectPage(99);
    expect(deps.pageView.showPage).toHaveBeenLastCalledWith(2);
    expect(deps.thumbnails.setSelected).toHaveBeenLastCalledWith(2);
  });
});

describe("matrix: Dialog cancelled", () => {
  it("keeps the empty state without a message", async () => {
    const { app, deps, open } = setup();
    await open("", null);

    expect(app.getDocument()).toBeNull();
    expect(deps.loadPdfDocument).not.toHaveBeenCalled();
    expect(deps.acceptOpenedPdf).not.toHaveBeenCalled();
    expect(deps.thumbnails.setDocument).not.toHaveBeenCalled();
    expect(deps.pageView.setDocument).not.toHaveBeenCalled();
    expect(deps.messages.show).not.toHaveBeenCalled();
  });

  it("keeps the open document and its selected page without a message", async () => {
    const { app, deps, loaded, open } = setup();
    await open("zehn.pdf", await makePdf(10));
    app.selectPage(4);
    const before = app.getDocument();
    clearCalls(deps);

    await open("", null);

    expect(app.getDocument()).toBe(before);
    expect(app.getDocument()?.state.selectedPageIndex).toBe(4);
    expect(deps.thumbnails.setDocument).not.toHaveBeenCalled();
    expect(deps.pageView.setDocument).not.toHaveBeenCalled();
    expect(deps.messages.show).not.toHaveBeenCalled();
    expect(deps.acceptOpenedPdf).not.toHaveBeenCalled();
    expect(loaded[0].destroy).not.toHaveBeenCalled();
  });
});

describe("matrix: Open another PDF", () => {
  it("replaces the old document, selects page 1, resets the strip and frees the old one", async () => {
    const { app, deps, loaded, open } = setup();
    await open("zehn.pdf", await makePdf(10));
    app.selectPage(6);
    clearCalls(deps);

    await open("drei.pdf", await makePdf(3));

    const [oldPdf, newPdf] = loaded;
    const doc = app.getDocument();
    expect(doc?.pdf).toBe(newPdf.pdf);
    expect(doc?.state.sourceName).toBe("drei.pdf");
    expect(doc?.state.pageCount).toBe(3);
    expect(doc?.state.selectedPageIndex).toBe(0);
    // The strip contract: setDocument rebuilds it, marks index 0 and scrolls to the top.
    expect(deps.thumbnails.setDocument).toHaveBeenCalledTimes(1);
    expect(deps.thumbnails.setDocument).toHaveBeenCalledWith(newPdf.pdf.proxy, 0);
    expect(deps.pageView.setDocument).toHaveBeenCalledWith(newPdf.pdf.proxy, 0);
    expect(deps.acceptOpenedPdf).toHaveBeenCalledTimes(1);
    expect(oldPdf.destroy).toHaveBeenCalledTimes(1);
    expect(newPdf.destroy).not.toHaveBeenCalled();
    // Views switched before the old document was destroyed.
    expect(deps.thumbnails.setDocument.mock.invocationCallOrder[0]).toBeLessThan(
      oldPdf.destroy.mock.invocationCallOrder[0],
    );
  });

  it("hides an earlier error as soon as a new open starts, even if it is cancelled", async () => {
    const { deps, open } = setup();
    await open("kaputt.pdf", NOT_A_PDF);
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.invalid);
    clearCalls(deps);
    deps.pickPdf.mockClear();

    await open("", null);

    expect(deps.messages.hide).toHaveBeenCalledTimes(1);
    expect(deps.messages.hide.mock.invocationCallOrder[0]).toBeLessThan(
      deps.pickPdf.mock.invocationCallOrder[0],
    );
    expect(deps.messages.show).not.toHaveBeenCalled();
  });

  it("clears an earlier error message", async () => {
    const { deps, open } = setup();
    await open("kaputt.pdf", NOT_A_PDF);
    await open("drei.pdf", await makePdf(3));
    expect(deps.messages.hide).toHaveBeenCalled();
  });
});

const REJECTED_FILES = [
  { row: "Password-protected", name: "geheim.pdf", bytes: USER_PASSWORD_PDF, message: MESSAGES.encrypted },
  { row: "Owner-password only", name: "rechte.pdf", bytes: OWNER_PASSWORD_ONLY_PDF, message: MESSAGES.encrypted },
  { row: "Corrupt / not a PDF", name: "kaputt.pdf", bytes: () => NOT_A_PDF, message: MESSAGES.invalid },
] as const;

for (const { row, name, bytes, message } of REJECTED_FILES) {
  describe(`matrix: ${row}`, () => {
    it("keeps the previous document, shows the German message and does not accept the file", async () => {
      const { app, deps, loaded, open } = setup();
      await open("zehn.pdf", await makePdf(10));
      app.selectPage(5);
      const before = app.getDocument();
      clearCalls(deps);

      await open(name, bytes());

      expect(deps.loadPdfDocument).toHaveBeenCalledTimes(1);
      expect(deps.messages.show).toHaveBeenCalledWith(message);
      expect(deps.acceptOpenedPdf).not.toHaveBeenCalled();
      expect(app.getDocument()).toBe(before);
      expect(app.getDocument()?.state.selectedPageIndex).toBe(5);
      expect(deps.thumbnails.setDocument).not.toHaveBeenCalled();
      expect(deps.pageView.setDocument).not.toHaveBeenCalled();
      expect(deps.toolbar.setDocumentName).not.toHaveBeenCalled();
      expect(loaded[0].destroy).not.toHaveBeenCalled();
      expect(deps.toolbar.setEnabled).toHaveBeenLastCalledWith("open", true);
    });

    it("keeps the empty state, shows the German message and does not accept the file", async () => {
      const { app, deps, open } = setup();
      await open(name, bytes());

      expect(deps.messages.show).toHaveBeenCalledWith(message);
      expect(deps.acceptOpenedPdf).not.toHaveBeenCalled();
      expect(app.getDocument()).toBeNull();
      expect(deps.thumbnails.setDocument).not.toHaveBeenCalled();
      expect(deps.pageView.setDocument).not.toHaveBeenCalled();
    });
  });
}

describe("backend failures", () => {
  it("shows the German read error, never the raw backend text, and keeps the state", async () => {
    const { app, deps } = setup();
    deps.pickPdf.mockRejectedValueOnce("Access is denied. (os error 5)");
    await app.openPdf();
    expect(deps.messages.show).toHaveBeenCalledTimes(1);
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.readFailed);
    expect(deps.log.error).toHaveBeenCalledWith("open_pdf failed", "Access is denied. (os error 5)");
    expect(app.getDocument()).toBeNull();
  });

  it("frees the new document and keeps the old one if accepting fails", async () => {
    const { app, deps, loaded, open } = setup();
    await open("zehn.pdf", await makePdf(10));
    const before = app.getDocument();
    deps.acceptOpenedPdf.mockRejectedValueOnce(new Error("ipc"));

    await open("drei.pdf", await makePdf(3));

    expect(app.getDocument()).toBe(before);
    expect(loaded[1].destroy).toHaveBeenCalledTimes(1);
    expect(loaded[0].destroy).not.toHaveBeenCalled();
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.readFailed);
  });
});

// ---- Story 2: signatures -------------------------------------------------

const PNG = makePng(300, 100);

async function withDocument(pages = 5) {
  const ctx = setup();
  await ctx.open("vertrag.pdf", await makePdf(pages));
  return ctx;
}

describe("signature toolbar state", () => {
  it("enables 'PNG Unterschrift einfügen' with a document and 'Element entfernen' only with a selection", async () => {
    const { app, enabled, insert } = await withDocument();
    expect(enabled("insertSignature")).toBe(true);
    expect(enabled("removeElement")).toBe(false);

    await insert(PNG);
    expect(enabled("removeElement")).toBe(true);
    app.selectElement(null);
    expect(enabled("removeElement")).toBe(false);
  });

  it("disables inserting while the PNG dialog is open", async () => {
    const { app, deps, enabled } = await withDocument();
    let release!: (value: Uint8Array | null) => void;
    deps.pickSignaturePng.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = app.insertSignature();
    expect(enabled("insertSignature")).toBe(false);
    await app.insertSignature(); // ignored meanwhile
    expect(deps.pickSignaturePng).toHaveBeenCalledTimes(1);
    release(null);
    await pending;
    expect(enabled("insertSignature")).toBe(true);
  });
});

describe("matrix: Insert", () => {
  it("places the PNG centered on the current page (page 3), 25% wide, upright and selected", async () => {
    const { app, deps, insert } = await withDocument();
    app.selectPage(2);
    deps.overlay.sync.mockClear();

    await insert(PNG);

    const state = app.getDocument()!.state;
    expect(state.elements).toHaveLength(1);
    const [element] = state.elements;
    expect(element).toMatchObject({ kind: "signature", pageIndex: 2, rotation: 0 });
    expect(state.selectedElementId).toBe(element.id);
    // A4 page (595 x 842): 25% of the width, PNG aspect 3:1, centered.
    expect(element.rect.width).toBeCloseTo(595 / 4);
    expect(element.rect.height).toBeCloseTo(595 / 12);
    expect(element.rect.x + element.rect.width / 2).toBeCloseTo(595 / 2);
    expect(element.rect.y + element.rect.height / 2).toBeCloseTo(842 / 2);
    // The image is stored as is, alpha and all.
    expect(element.kind === "signature" && state.images.get(element.imageId)?.bytes).toEqual(PNG);
    expect(deps.overlay.sync).toHaveBeenLastCalledWith(state);
    expect(deps.messages.show).not.toHaveBeenCalled();
  });

  it("uses the shown viewport when the page is on screen, with the same page-relative result", async () => {
    const { app, deps, loaded, insert } = await withDocument();
    const page = await loaded[0].pdf.proxy.getPage(1);
    const viewport = page.getViewport({ scale: 1.7 });
    deps.pageView.getShownPage.mockReturnValue({ pageIndex: 0, viewport });

    await insert(PNG);

    const [element] = app.getDocument()!.state.elements;
    expect(element.rect.width).toBeCloseTo(595 / 4);
    expect(element.rect.x + element.rect.width / 2).toBeCloseTo(595 / 2);
  });

  it("stores identical PNG bytes once", async () => {
    const { app, insert } = await withDocument();
    await insert(PNG);
    await insert(PNG.slice());
    await insert(makePng(10, 10));
    const state = app.getDocument()!.state;
    expect(state.elements).toHaveLength(3);
    expect(state.images.size).toBe(2);
    expect(state.selectedElementId).toBe(state.elements[2].id);
  });
});

describe("matrix: PNG dialog cancelled / not a PNG", () => {
  it("cancel changes nothing and shows no message", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(null);
    expect(app.getDocument()!.state.elements).toHaveLength(0);
    expect(deps.messages.show).not.toHaveBeenCalled();
  });

  it("a file that is not a PNG adds nothing and shows the German message", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(new TextEncoder().encode("kein Bild"));
    await insert(new Uint8Array()); // empty file (backend's "empty-file")
    expect(app.getDocument()!.state.elements).toHaveLength(0);
    expect(deps.messages.show).toHaveBeenCalledTimes(2);
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.invalidPng);
    expect(MESSAGES.invalidPng).toBe("Die Datei konnte nicht als PNG-Bild geladen werden.");
    expect(deps.decodePng).not.toHaveBeenCalled();
  });

  it("a PNG the webview cannot decode is refused too", async () => {
    const { app, deps, insert } = await withDocument();
    deps.decodePng.mockRejectedValueOnce(new Error("decode"));
    await insert(PNG);
    expect(app.getDocument()!.state.elements).toHaveLength(0);
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.invalidPng);
  });

  it("a backend failure shows the German read error", async () => {
    const { app, deps } = await withDocument();
    deps.pickSignaturePng.mockRejectedValueOnce("os error 5");
    await app.insertSignature();
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.readFailed);
    expect(app.getDocument()!.state.elements).toHaveLength(0);
  });
});

describe("matrix: Select / deselect / remove", () => {
  it("'Element entfernen' removes the selected signature from the model", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    app.handleToolbarAction("removeElement");
    const state = app.getDocument()!.state;
    expect(state.elements).toHaveLength(0);
    expect(state.selectedElementId).toBeNull();
    expect(state.images.size).toBe(0);
    expect(enabled("removeElement")).toBe(false);
    expect(deps.overlay.sync).toHaveBeenLastCalledWith(state);
  });

  it("the frame's '×' removes that signature", async () => {
    const { app, insert } = await withDocument();
    await insert(PNG);
    const id = app.getDocument()!.state.elements[0].id;
    app.removeElement(id);
    expect(app.getDocument()!.state.elements).toHaveLength(0);
  });

  it("Entf/Backspace remove the selection, Esc deselects", async () => {
    const { app, insert } = await withDocument();
    await insert(PNG);
    await insert(PNG);
    const state = app.getDocument()!.state;

    expect(app.handleShortcut("removeElement")).toBe(true);
    expect(state.elements).toHaveLength(1);
    expect(app.handleShortcut("removeElement")).toBe(false); // nothing selected

    app.selectElement(state.elements[0].id);
    expect(app.handleShortcut("deselect")).toBe(true);
    expect(state.selectedElementId).toBeNull();
    expect(app.handleShortcut("deselect")).toBe(false);
    expect(state.elements).toHaveLength(1);
  });

  it("stores geometry updates from the overlay", async () => {
    const { app, insert } = await withDocument();
    await insert(PNG);
    const [element] = app.getDocument()!.state.elements;
    const rect = { x: 1, y: 2, width: 30, height: 10 };
    app.updateElement(element.id, { rect, rotation: 400 });
    expect(element.rect).toEqual(rect);
    expect(element.rotation).toBe(40);
  });
});

describe("matrix: Page switch / Many", () => {
  it("keeps signatures on their pages and drops a selection that is not on the new page", async () => {
    const { app, insert } = await withDocument(6);
    app.selectPage(1);
    await insert(PNG);
    app.selectPage(4);
    await insert(PNG);
    const state = app.getDocument()!.state;
    const [onTwo, onFive] = state.elements;
    expect(onTwo.pageIndex).toBe(1);
    expect(onFive.pageIndex).toBe(4);
    const geometry = JSON.stringify(state.elements);

    app.selectPage(1);
    expect(state.selectedElementId).toBeNull();
    app.selectElement(onTwo.id);
    app.selectPage(1); // same page: selection stays
    expect(state.selectedElementId).toBe(onTwo.id);
    app.selectPage(4);
    app.selectPage(1);
    expect(JSON.stringify(state.elements)).toBe(geometry);
  });

  it("holds 20 signatures across pages, each selectable", async () => {
    const { app, insert } = await withDocument(4);
    for (let i = 0; i < 20; i++) {
      app.selectPage(i % 4);
      await insert(PNG);
    }
    const state = app.getDocument()!.state;
    expect(state.elements).toHaveLength(20);
    expect(new Set(state.elements.map((e) => e.id)).size).toBe(20);
    for (const element of state.elements) {
      app.selectPage(element.pageIndex);
      app.selectElement(element.id);
      expect(state.selectedElementId).toBe(element.id);
    }
  });

  it("ignores selecting an element of another page (e.g. clicked before the new page rendered)", async () => {
    const { app, insert, enabled } = await withDocument();
    await insert(PNG);
    const state = app.getDocument()!.state;
    const onFirst = state.elements[0].id;
    app.selectPage(1);

    app.selectElement(onFirst);

    expect(state.selectedElementId).toBeNull();
    expect(enabled("removeElement")).toBe(false);
    expect(app.handleShortcut("removeElement")).toBe(false);
    expect(state.elements).toHaveLength(1);
  });
});

describe("matrix: Open another PDF with elements placed", () => {
  it("'Abbrechen' keeps everything and shows no file dialog", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(PNG);
    const before = app.getDocument();
    deps.pickPdf.mockClear();
    deps.confirmDiscard.mockResolvedValueOnce(false);

    await app.openPdf();

    expect(deps.confirmDiscard).toHaveBeenCalledTimes(1);
    expect(deps.pickPdf).not.toHaveBeenCalled();
    expect(app.getDocument()).toBe(before);
    expect(before!.state.elements).toHaveLength(1);
    expect(deps.toolbar.setEnabled).toHaveBeenLastCalledWith("open", true);
  });

  it("'Verwerfen' continues to the file dialog and the new document has no elements", async () => {
    const { app, deps, insert, open } = await withDocument();
    await insert(PNG);
    deps.overlay.sync.mockClear();

    await open("neu.pdf", await makePdf(2));

    expect(deps.confirmDiscard).toHaveBeenCalledTimes(1);
    const state = app.getDocument()!.state;
    expect(state.sourceName).toBe("neu.pdf");
    expect(state.elements).toHaveLength(0);
    expect(deps.overlay.sync).toHaveBeenLastCalledWith(state);
  });

  it("does not ask without placed elements", async () => {
    const { deps, open } = await withDocument();
    await open("neu.pdf", await makePdf(2));
    expect(deps.confirmDiscard).not.toHaveBeenCalled();
    expect(deps.pickPdf).toHaveBeenCalledTimes(2);
  });

  it("leaves the discarded document alone while the replacement is being opened", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    const state = app.getDocument()!.state;
    const [element] = state.elements;
    let release!: (value: OpenedPdf | null) => void;
    deps.pickPdf.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    deps.pickSignaturePng.mockClear();

    const pending = app.openPdf(); // "Verwerfen" (default fake answer), file dialog open
    await vi.waitFor(() => expect(deps.pickPdf).toHaveBeenCalledTimes(2));

    expect(enabled("insertSignature")).toBe(false);
    expect(enabled("removeElement")).toBe(false);
    expect(app.handleShortcut("removeElement")).toBe(false);
    expect(app.handleShortcut("deselect")).toBe(false);
    app.removeElement(element.id);
    app.handleToolbarAction("removeElement");
    await app.insertSignature();
    expect(deps.pickSignaturePng).not.toHaveBeenCalled();
    expect(state.elements).toEqual([element]);
    expect(state.selectedElementId).toBe(element.id);

    release(null); // cancelled: the old document stays and is editable again
    await pending;
    expect(app.getDocument()!.state).toBe(state);
    expect(enabled("insertSignature")).toBe(true);
    expect(enabled("removeElement")).toBe(true);
  });

  it("ignores shortcuts while the question is open", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(PNG);
    let answer!: (value: boolean) => void;
    deps.confirmDiscard.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const pending = app.openPdf();
    expect(app.handleShortcut("removeElement")).toBe(false);
    answer(false);
    await pending;
    expect(app.getDocument()!.state.elements).toHaveLength(1);
  });
});
