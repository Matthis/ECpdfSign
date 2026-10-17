// I/O & edge-case matrix of story 1, exercised through the app flow with fake
// backend/views and the real PDF loader (pdf.js + pdf-lib in Node).

import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, MESSAGES, savedMessage, signatureWarning, type AppDeps } from "./app";
import type { OpenedPdf } from "./backend";
import { loadPdfDocument, type LoadedPdf } from "./pdf/document";
import { OWNER_PASSWORD_ONLY_PDF, USER_PASSWORD_PDF } from "./pdf/encryptedFixtures.test-data";
import { getDocument, OPS } from "./pdf/pdfjs";
import { buildSignedPdf } from "./pdf/save";
import { makeMalformedFormPdf, makeSignedPdf } from "./pdf/signatureFixtures.test-data";
import { encodePng, makeAnimatedPng, makePng } from "./signature/pngFixtures.test-data";
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
    buildSignedPdf: vi.fn(buildSignedPdf),
    savePdf: vi.fn(async (_bytes: Uint8Array): Promise<string | null> => "vertrag_signiert.pdf"),
    confirmDiscard: vi.fn(async () => true),
    confirmInvalidateSignatures: vi.fn(async (_count: number) => true),
    toolbar: { setEnabled: vi.fn(), setDocumentName: vi.fn() },
    pageView: {
      setDocument: vi.fn(),
      showPage: vi.fn(),
      getShownPage: vi.fn((): ShownPage | null => null),
    },
    thumbnails: { setDocument: vi.fn(), setSelected: vi.fn() },
    overlay: { sync: vi.fn() },
    messages: { show: vi.fn(), info: vi.fn(), hide: vi.fn() },
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

/** A PDF pdf.js shows but pdf-lib cannot load: its %PDF header is broken. */
async function uneditablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const bytes = await doc.save({ useObjectStreams: false });
  const index = new TextDecoder("latin1").decode(bytes).indexOf("%PDF-");
  bytes.set(new TextEncoder().encode("%XYZ-"), index);
  return bytes;
}

describe("German messages", () => {
  it("are German and distinguish encrypted from unreadable files", () => {
    expect(MESSAGES.encrypted).toBe(
      "Passwortgeschützte oder verschlüsselte PDF-Dateien werden noch nicht unterstützt.",
    );
    expect(MESSAGES.invalid).toBe("Die Datei konnte nicht als PDF geöffnet werden.");
    expect(MESSAGES.uneditable).toBe("Diese PDF-Datei kann nicht bearbeitet werden.");
  });

  it("are German for saving", () => {
    expect(MESSAGES.buildFailed).toBe("Die PDF-Datei konnte nicht erstellt werden.");
    expect(MESSAGES.saveFailed).toBe(
      "Die Datei konnte nicht gespeichert werden. Ist sie in einem anderen Programm geöffnet oder schreibgeschützt?",
    );
    expect(savedMessage("Vertrag_signiert.pdf")).toBe("Gespeichert: Vertrag_signiert.pdf");
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
    for (const action of ["insertPlaceDate", "insertSignature", "save"] as const) {
      app.handleToolbarAction(action);
    }
    expect(deps.pickPdf).not.toHaveBeenCalled();
    expect(deps.pickSignaturePng).not.toHaveBeenCalled();
    expect(deps.confirmDiscard).not.toHaveBeenCalled();
    // Removal is shortcut/"×"-only now; without a document it does nothing.
    expect(app.handleShortcut("removeElement")).toBe(false);
    expect(app.getDocument()).toBeNull();
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
  { row: "Password-protected", name: "geheim.pdf", bytes: async () => USER_PASSWORD_PDF(), message: MESSAGES.encrypted },
  { row: "Owner-password only", name: "rechte.pdf", bytes: async () => OWNER_PASSWORD_ONLY_PDF(), message: MESSAGES.encrypted },
  { row: "Corrupt / not a PDF", name: "kaputt.pdf", bytes: async () => NOT_A_PDF, message: MESSAGES.invalid },
  { row: "pdf-lib cannot load", name: "seltsam.pdf", bytes: uneditablePdf, message: MESSAGES.uneditable },
] as const;

for (const { row, name, bytes, message } of REJECTED_FILES) {
  describe(`matrix: ${row}`, () => {
    it("keeps the previous document, shows the German message and does not accept the file", async () => {
      const { app, deps, loaded, open } = setup();
      await open("zehn.pdf", await makePdf(10));
      app.selectPage(5);
      const before = app.getDocument();
      clearCalls(deps);

      await open(name, await bytes());

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
      await open(name, await bytes());

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
  it("keeps 'PNG Unterschrift einfügen' enabled with a document, with and without a selection", async () => {
    const { app, enabled, insert } = await withDocument();
    expect(enabled("insertSignature")).toBe(true);

    await insert(PNG);
    expect(enabled("insertSignature")).toBe(true);
    app.selectElement(null);
    expect(enabled("insertSignature")).toBe(true);
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
  it("Entf removes the selected signature from the model, together with its unused image", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(PNG);
    expect(app.handleShortcut("removeElement")).toBe(true);
    const state = app.getDocument()!.state;
    expect(state.elements).toHaveLength(0);
    expect(state.selectedElementId).toBeNull();
    expect(state.images.size).toBe(0);
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
    const { app, insert } = await withDocument();
    await insert(PNG);
    const state = app.getDocument()!.state;
    const onFirst = state.elements[0].id;
    app.selectPage(1);

    app.selectElement(onFirst);

    expect(state.selectedElementId).toBeNull();
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
    expect(app.handleShortcut("removeElement")).toBe(false);
    expect(app.handleShortcut("deselect")).toBe(false);
    app.removeElement(element.id);
    await app.insertSignature();
    expect(deps.pickSignaturePng).not.toHaveBeenCalled();
    expect(state.elements).toEqual([element]);
    expect(state.selectedElementId).toBe(element.id);

    release(null); // cancelled: the old document stays and is editable again
    await pending;
    expect(app.getDocument()!.state).toBe(state);
    expect(enabled("insertSignature")).toBe(true);
    expect(app.handleShortcut("removeElement")).toBe(true);
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

// ---- Story 3: save as new PDF --------------------------------------------

/** Page index of every image pdf.js paints in `bytes`, in page order. */
async function imagePages(bytes: Uint8Array): Promise<number[]> {
  const task = getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const pages: number[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const { fnArray } = await (await doc.getPage(i + 1)).getOperatorList();
      for (const fn of fnArray) if (fn === OPS.paintImageXObject) pages.push(i);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

describe("save toolbar state", () => {
  it("enables 'Speichern' only while at least one element is placed", async () => {
    const { app, enabled, insert } = await withDocument();
    expect(enabled("save")).toBe(false);

    await insert(PNG);
    expect(enabled("save")).toBe(true);

    app.handleShortcut("removeElement");
    expect(enabled("save")).toBe(false);
  });

  it("is disabled without a document and while another PDF is being opened", async () => {
    const empty = setup();
    await empty.app.save();
    expect(empty.deps.buildSignedPdf).not.toHaveBeenCalled();

    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    let release!: (value: OpenedPdf | null) => void;
    deps.pickPdf.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = app.openPdf();
    await vi.waitFor(() => expect(deps.pickPdf).toHaveBeenCalledTimes(2));

    expect(enabled("save")).toBe(false);
    await app.save();
    expect(deps.buildSignedPdf).not.toHaveBeenCalled();

    release(null);
    await pending;
    expect(enabled("save")).toBe(true);
  });
});

describe("matrix: Save", () => {
  it("builds from the source and every placement, then hands the bytes to the save dialog", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    app.selectPage(2);
    await insert(PNG);
    const state = app.getDocument()!.state;
    const sourceBefore = state.sourceBytes.slice();
    const elementsBefore = structuredClone(state.elements);

    app.handleToolbarAction("save");
    await vi.waitFor(() => expect(deps.messages.info).toHaveBeenCalled());

    expect(deps.buildSignedPdf).toHaveBeenCalledTimes(1);
    const [source, elements, images, viewports] = deps.buildSignedPdf.mock.calls[0];
    expect(source).toBe(state.sourceBytes);
    expect(elements).toEqual(state.elements);
    expect(images.size).toBe(1);
    expect([...viewports.keys()].sort()).toEqual([0, 2]);
    expect(viewports.get(0)?.scale).toBe(1);

    expect(deps.savePdf).toHaveBeenCalledTimes(1);
    const saved = deps.savePdf.mock.calls[0][0];
    expect(saved).toBe(await deps.buildSignedPdf.mock.results[0].value);
    expect(await imagePages(saved)).toEqual([0, 2]);
    expect(deps.buildSignedPdf.mock.invocationCallOrder[0]).toBeLessThan(
      deps.savePdf.mock.invocationCallOrder[0],
    );

    expect(deps.messages.info).toHaveBeenCalledWith("Gespeichert: vertrag_signiert.pdf");
    expect(deps.messages.show).not.toHaveBeenCalled();
    // Nothing about the document changed: source bytes, elements, selection.
    expect(state.sourceBytes).toEqual(sourceBefore);
    expect(state.elements).toEqual(elementsBefore);
    expect(app.getDocument()!.state).toBe(state);
    expect(enabled("save")).toBe(true);
    expect(deps.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("is busy while saving: 'Speichern' and 'PDF Öffnen' are disabled and a second save is ignored", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    let finish!: (name: string | null) => void;
    deps.savePdf.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    const pending = app.save();
    await vi.waitFor(() => expect(deps.savePdf).toHaveBeenCalledTimes(1));
    expect(enabled("save")).toBe(false);
    expect(enabled("open")).toBe(false);
    expect(enabled("insertSignature")).toBe(false);
    expect(deps.setBusy).toHaveBeenLastCalledWith(true);
    await app.save();
    await app.openPdf();
    // The frame's "×" and Entf cannot remove the element being saved.
    const state = app.getDocument()!.state;
    app.removeElement(state.elements[0].id);
    expect(app.handleShortcut("removeElement")).toBe(false);
    expect(state.elements).toHaveLength(1);
    expect(deps.buildSignedPdf).toHaveBeenCalledTimes(1);
    expect(deps.pickPdf).toHaveBeenCalledTimes(1); // only the initial open

    finish("x.pdf");
    await pending;
    expect(enabled("save")).toBe(true);
    expect(enabled("open")).toBe(true);
    expect(enabled("insertSignature")).toBe(true);
    expect(deps.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("saves what was placed when 'Speichern' was clicked, even if an element moves meanwhile", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(PNG);
    const [element] = app.getDocument()!.state.elements;
    const rect = { ...element.rect };
    let finishBuild!: () => void;
    const gate = new Promise<void>((resolve) => (finishBuild = resolve));
    deps.buildSignedPdf.mockImplementationOnce(async (...args) => {
      await gate;
      return buildSignedPdf(...args);
    });

    const pending = app.save();
    await vi.waitFor(() => expect(deps.buildSignedPdf).toHaveBeenCalled());
    app.updateElement(element.id, { rect: { ...rect, x: rect.x + 100 }, rotation: 0 });
    finishBuild();
    await pending;

    expect(deps.buildSignedPdf.mock.calls[0][1][0].rect).toEqual(rect);
  });
});

describe("save while a PNG is being inserted", () => {
  it("is disabled and ignored until the insert has finished", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    let release!: (value: Uint8Array | null) => void;
    deps.pickSignaturePng.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const pending = app.insertSignature();
    expect(enabled("save")).toBe(false);
    await app.save();
    expect(deps.buildSignedPdf).not.toHaveBeenCalled();

    release(PNG);
    await pending;
    expect(enabled("save")).toBe(true);
    await app.save();
    expect(deps.buildSignedPdf.mock.calls[0][1]).toHaveLength(2);
  });
});

describe("'Gespeichert' notice", () => {
  async function saved() {
    const ctx = await withDocument();
    await ctx.insert(PNG);
    await ctx.app.save();
    expect(ctx.deps.messages.info).toHaveBeenCalledTimes(1);
    ctx.deps.messages.hide.mockClear();
    return ctx;
  }

  it("disappears when an element is moved", async () => {
    const { app, deps } = await saved();
    const [element] = app.getDocument()!.state.elements;
    app.updateElement(element.id, { rect: { ...element.rect, x: element.rect.x + 5 }, rotation: 0 });
    expect(deps.messages.hide).toHaveBeenCalledTimes(1);
    app.updateElement(element.id, { rect: { ...element.rect, x: element.rect.x + 5 }, rotation: 0 });
    expect(deps.messages.hide).toHaveBeenCalledTimes(1); // already gone
  });

  it("disappears when an element is removed or inserted", async () => {
    const removed = await saved();
    removed.app.handleShortcut("removeElement");
    expect(removed.deps.messages.hide).toHaveBeenCalledTimes(1);

    const inserted = await saved();
    await inserted.insert(PNG);
    expect(inserted.deps.messages.hide).toHaveBeenCalled();
  });

  it("stays while only the selection or page changes", async () => {
    const { app, deps } = await saved();
    app.selectElement(null);
    app.selectPage(1);
    expect(deps.messages.hide).not.toHaveBeenCalled();
  });

  it("an error shown afterwards is not hidden by the next element change", async () => {
    const { app, deps, insert } = await saved();
    await insert(new TextEncoder().encode("kein Bild")); // error: not a PNG
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.invalidPng);
    deps.messages.hide.mockClear();
    const [element] = app.getDocument()!.state.elements;
    app.updateElement(element.id, { rect: { ...element.rect, x: element.rect.x + 5 }, rotation: 0 });
    expect(deps.messages.hide).not.toHaveBeenCalled();
  });
});

describe("matrix: Save dialog cancelled", () => {
  it("writes nothing and shows no message", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    deps.savePdf.mockResolvedValueOnce(null);
    await app.save();
    expect(deps.messages.info).not.toHaveBeenCalled();
    expect(deps.messages.show).not.toHaveBeenCalled();
    expect(app.getDocument()!.state.elements).toHaveLength(1);
    expect(enabled("save")).toBe(true);
  });
});

describe("matrix: Target = source", () => {
  it("keeps the placements, and a second save starts again from the unchanged in-memory source", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(PNG);
    const state = app.getDocument()!.state;
    const before = state.sourceBytes.slice();
    deps.savePdf.mockResolvedValue("vertrag.pdf"); // the user picked the original's name

    await app.save();
    await app.save();

    expect(deps.savePdf).toHaveBeenCalledTimes(2);
    expect(deps.buildSignedPdf.mock.calls[1][0]).toEqual(before);
    expect(state.sourceBytes).toEqual(before);
    expect(state.elements).toHaveLength(1);
    // Built from the source each time, so the second file has one signature, not two.
    expect(await imagePages(deps.savePdf.mock.calls[1][0])).toEqual([0]);
    expect(deps.messages.info).toHaveBeenLastCalledWith("Gespeichert: vertrag.pdf");
  });
});

describe("matrix: Write fails", () => {
  it("shows the German save error, never the raw backend text", async () => {
    const { app, deps, insert } = await withDocument();
    await insert(PNG);
    deps.savePdf.mockRejectedValueOnce("Die Datei konnte nicht gespeichert werden (Zugriff verweigert (os error 5)).");
    await app.save();
    expect(deps.messages.show).toHaveBeenCalledTimes(1);
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.saveFailed);
    expect(deps.messages.info).not.toHaveBeenCalled();
    expect(deps.log.error).toHaveBeenCalledWith("save_pdf failed", expect.anything());
    expect(app.getDocument()!.state.elements).toHaveLength(1);
  });
});

describe("matrix: Build fails", () => {
  it("writes nothing, shows no dialog and the German build error", async () => {
    const { app, deps, insert, enabled } = await withDocument();
    await insert(PNG);
    deps.buildSignedPdf.mockRejectedValueOnce(new Error("pdf-lib"));
    await app.save();
    expect(deps.savePdf).not.toHaveBeenCalled();
    expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.buildFailed);
    expect(enabled("save")).toBe(true);
    expect(enabled("open")).toBe(true);
  });
});

describe("matrix: PNG not embeddable", () => {
  const notEmbeddable = [
    ["an animated PNG", makeAnimatedPng(8, 8)],
    [
      "an interlaced PNG pdf-lib cannot decode",
      encodePng({ width: 13, height: 9, bitDepth: 8, colorType: 6, samples: () => [0, 0, 0, 255], interlace: true }),
    ],
  ] as const;

  for (const [name, png] of notEmbeddable) {
    it(`refuses ${name} that the webview decodes, with the PNG message`, async () => {
      const { app, deps, insert, enabled } = await withDocument();
      await insert(png);
      expect(deps.decodePng).toHaveBeenCalledTimes(1);
      expect(app.getDocument()!.state.elements).toHaveLength(0);
      expect(app.getDocument()!.state.images.size).toBe(0);
      expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.invalidPng);
      expect(enabled("save")).toBe(false);
    });
  }
});

describe("story 4: digitally signed PDFs", () => {
  async function withSignedDocument(fields: Parameters<typeof makeSignedPdf>[0] = [{}]) {
    const ctx = setup();
    await ctx.open("signiert.pdf", await makeSignedPdf(fields));
    await ctx.insert(PNG);
    return ctx;
  }

  describe("matrix: Signed PDF, continue", () => {
    it("warns with the count before building, then builds and opens the save dialog", async () => {
      const { app, deps } = await withSignedDocument();
      expect(app.getDocument()!.state.signedSignatureCount).toBe(1);
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledExactlyOnceWith(1);
      expect(deps.confirmInvalidateSignatures.mock.invocationCallOrder[0]).toBeLessThan(
        deps.buildSignedPdf.mock.invocationCallOrder[0],
      );
      expect(deps.savePdf).toHaveBeenCalledTimes(1);
      expect(deps.messages.info).toHaveBeenLastCalledWith("Gespeichert: vertrag_signiert.pdf");
    });
  });

  describe("matrix: Signed PDF, cancel", () => {
    it("'Abbrechen' / Esc: nothing built, no save dialog, no message, placements kept", async () => {
      const { app, deps, enabled } = await withSignedDocument();
      const elementsBefore = structuredClone(app.getDocument()!.state.elements);
      clearCalls(deps);
      deps.setBusy.mockClear();
      deps.confirmInvalidateSignatures.mockResolvedValueOnce(false);
      await app.save();
      expect(deps.setBusy).not.toHaveBeenCalledWith(true);
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(1);
      expect(deps.buildSignedPdf).not.toHaveBeenCalled();
      expect(deps.savePdf).not.toHaveBeenCalled();
      expect(deps.messages.show).not.toHaveBeenCalled();
      expect(deps.messages.info).not.toHaveBeenCalled();
      expect(deps.messages.hide).not.toHaveBeenCalled();
      expect(app.getDocument()!.state.elements).toEqual(elementsBefore);
      expect(enabled("save")).toBe(true);
      expect(enabled("open")).toBe(true);
    });

    it("a failing question counts as 'Abbrechen' and is logged", async () => {
      const { app, deps } = await withSignedDocument();
      deps.confirmInvalidateSignatures.mockRejectedValueOnce(new Error("dialog"));
      await app.save();
      expect(deps.buildSignedPdf).not.toHaveBeenCalled();
      expect(deps.savePdf).not.toHaveBeenCalled();
      expect(deps.log.error).toHaveBeenCalledWith("signature warning failed", expect.anything());
    });

    it("blocks shortcuts, a second save and opening while the warning is open", async () => {
      const { app, deps, enabled } = await withSignedDocument();
      let answer!: (proceed: boolean) => void;
      deps.confirmInvalidateSignatures.mockImplementationOnce(
        () => new Promise((resolve) => (answer = resolve)),
      );
      deps.setBusy.mockClear();
      const pending = app.save();
      expect(enabled("save")).toBe(false);
      expect(app.handleShortcut("removeElement")).toBe(false);
      await app.save();
      await app.openPdf();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(1);
      expect(deps.pickPdf).toHaveBeenCalledTimes(1); // only the initial open
      expect(deps.setBusy).not.toHaveBeenCalledWith(true);
      answer(false);
      await pending;
      expect(app.getDocument()!.state.elements).toHaveLength(1);
      expect(enabled("save")).toBe(true);
    });
  });

  describe("matrix: Unsigned PDF / Empty signature field", () => {
    it("an unsigned PDF saves without a warning", async () => {
      const { app, deps, insert } = await withDocument();
      await insert(PNG);
      await app.save();
      expect(deps.confirmInvalidateSignatures).not.toHaveBeenCalled();
      expect(deps.savePdf).toHaveBeenCalledTimes(1);
    });

    it("a PDF with only an empty signature field saves without a warning", async () => {
      const { app, deps } = await withSignedDocument([{ signed: false }]);
      expect(app.getDocument()!.state.signedSignatureCount).toBe(0);
      await app.save();
      expect(deps.confirmInvalidateSignatures).not.toHaveBeenCalled();
      expect(deps.savePdf).toHaveBeenCalledTimes(1);
    });
  });

  describe("matrix: Nested field / Several signatures", () => {
    it("detects a signed field nested in a parent's /Kids", async () => {
      const { app, deps } = await withSignedDocument([{ layout: "nested" }]);
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledWith(1);
    });

    it("passes a count of 2, shown as '2 digitale Signaturen'", async () => {
      const { app, deps } = await withSignedDocument([{}, {}]);
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledWith(2);
      expect(signatureWarning(2)).toContain("2 digitale Signaturen");
    });
  });

  describe("matrix: Second save / Ask again after cancel", () => {
    it("asks only once after 'Trotzdem speichern', even if that save was cancelled or failed", async () => {
      const { app, deps } = await withSignedDocument();
      deps.savePdf.mockResolvedValueOnce(null); // save dialog cancelled
      await app.save();
      deps.savePdf.mockRejectedValueOnce("os error"); // write failed
      await app.save();
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(1);
      expect(deps.savePdf).toHaveBeenCalledTimes(3);
    });

    it("does not ask again after 'Trotzdem speichern' when building that save failed", async () => {
      const { app, deps } = await withSignedDocument();
      deps.buildSignedPdf.mockRejectedValueOnce(new Error("pdf-lib"));
      await app.save();
      expect(deps.messages.show).toHaveBeenCalledWith(MESSAGES.buildFailed);
      expect(deps.savePdf).not.toHaveBeenCalled();
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(1);
      expect(deps.savePdf).toHaveBeenCalledTimes(1);
    });

    it("asks again after 'Abbrechen'", async () => {
      const { app, deps } = await withSignedDocument();
      deps.confirmInvalidateSignatures.mockResolvedValueOnce(false);
      await app.save();
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(2);
      expect(deps.savePdf).toHaveBeenCalledTimes(1);
    });
  });

  describe("matrix: Reopen", () => {
    it("opening a signed PDF again (same file or another) warns again on the next save", async () => {
      const { app, deps, open, insert } = await withSignedDocument();
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(1);

      await open("signiert.pdf", await makeSignedPdf([{}])); // the same file again
      await insert(PNG);
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(2);

      await open("anderes.pdf", await makeSignedPdf([{}, {}]));
      await insert(PNG);
      await app.save();
      expect(deps.confirmInvalidateSignatures).toHaveBeenCalledTimes(3);
      expect(deps.confirmInvalidateSignatures).toHaveBeenLastCalledWith(2);
    });
  });

  describe("matrix: Open notice / Open unsigned", () => {
    it("shows the info notice right after opening a signed PDF", async () => {
      const { deps, open } = setup();
      await open("signiert.pdf", await makeSignedPdf([{}]));
      expect(deps.messages.info).toHaveBeenCalledExactlyOnceWith(MESSAGES.signedPdf);
      expect(MESSAGES.signedPdf).toBe(
        "Dieses PDF ist digital signiert. Beim Speichern werden die Signaturen ungültig.",
      );
      expect(deps.messages.show).not.toHaveBeenCalled();
    });

    it("shows no notice for an unsigned PDF", async () => {
      const { deps } = await withDocument();
      expect(deps.messages.info).not.toHaveBeenCalled();
    });

    it("is replaced when another, unsigned PDF is opened", async () => {
      const { deps, open } = setup();
      await open("signiert.pdf", await makeSignedPdf([{}]));
      clearCalls(deps);
      await open("vertrag.pdf", await makePdf(1));
      expect(deps.messages.hide).toHaveBeenCalled();
      expect(deps.messages.info).not.toHaveBeenCalled();
    });
  });

  describe("matrix: Malformed AcroForm", () => {
    for (const kind of ["fieldsNotArray", "cycle", "brokenRef"] as const) {
      it(`opens (${kind}) with count 0 and no message, logs, and saves without a warning`, async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
          const { app, deps, open, insert } = setup();
          await open("kaputt.pdf", await makeMalformedFormPdf(kind));
          expect(app.getDocument()?.state.signedSignatureCount).toBe(0);
          expect(consoleError).toHaveBeenCalled();
          expect(deps.messages.show).not.toHaveBeenCalled();
          expect(deps.messages.info).not.toHaveBeenCalled();
          await insert(PNG);
          await app.save();
          expect(deps.confirmInvalidateSignatures).not.toHaveBeenCalled();
          expect(deps.savePdf).toHaveBeenCalledTimes(1);
        } finally {
          consoleError.mockRestore();
        }
      });
    }
  });
});
