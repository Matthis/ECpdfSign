// I/O & edge-case matrix of story 1, exercised through the app flow with fake
// backend/views and the real PDF loader (pdf.js + pdf-lib in Node).

import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, MESSAGES, type AppDeps } from "./app";
import type { OpenedPdf } from "./backend";
import { loadPdfDocument, type LoadedPdf } from "./pdf/document";
import { OWNER_PASSWORD_ONLY_PDF, USER_PASSWORD_PDF } from "./pdf/encryptedFixtures.test-data";

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
    toolbar: { setEnabled: vi.fn(), setDocumentName: vi.fn() },
    pageView: { setDocument: vi.fn(), showPage: vi.fn() },
    thumbnails: { setDocument: vi.fn(), setSelected: vi.fn() },
    messages: { show: vi.fn(), hide: vi.fn() },
    setBusy: vi.fn(),
    log: { error: vi.fn(), warn: vi.fn() },
  } satisfies AppDeps;
  const app = createApp(deps);

  async function open(name: string, bytes: Uint8Array | null): Promise<void> {
    picks.push(bytes ? { name, bytes } : null);
    await app.openPdf();
  }

  return { app, deps, loaded, open };
}

/** Clears call records so a test can assert what one action did. */
function clearCalls(deps: ReturnType<typeof setup>["deps"]): void {
  for (const group of [deps.toolbar, deps.pageView, deps.thumbnails, deps.messages]) {
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

  it("the other actions do nothing yet", () => {
    const { app, deps } = setup();
    for (const action of ["insertPlaceDate", "insertSignature", "removeElement", "save"] as const) {
      app.handleToolbarAction(action);
    }
    expect(deps.pickPdf).not.toHaveBeenCalled();
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
