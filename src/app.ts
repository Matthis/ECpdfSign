// Application flow: opening a PDF and selecting pages. DOM-free so it can be
// unit-tested with fakes; src/main.ts wires it to the real backend and views.

import type { OpenedPdf } from "./backend";
import { clampPageIndex, createDocumentState, type DocumentState } from "./model";
import { classifyLoadError, type LoadedPdf } from "./pdf/document";
import type { PDFDocumentProxy } from "./pdf/pdfjs";
import type { ToolbarAction } from "./ui/toolbar";

export const MESSAGES = {
  encrypted:
    "Passwortgeschützte oder verschlüsselte PDF-Dateien werden noch nicht unterstützt.",
  invalid: "Die Datei konnte nicht als PDF geöffnet werden.",
  readFailed: "Die Datei konnte nicht gelesen werden.",
} as const;

export interface AppDeps {
  pickPdf(): Promise<OpenedPdf | null>;
  acceptOpenedPdf(): Promise<void>;
  loadPdfDocument(bytes: Uint8Array): Promise<LoadedPdf>;
  toolbar: {
    setEnabled(action: ToolbarAction, enabled: boolean): void;
    setDocumentName(name: string | null): void;
  };
  /** Contract: `setDocument` shows `pageIndex` of the new document. */
  pageView: {
    setDocument(doc: PDFDocumentProxy | null, pageIndex: number): void;
    showPage(pageIndex: number): void;
  };
  /** Contract: `setDocument` rebuilds the strip, marks `selectedIndex` and scrolls to the top. */
  thumbnails: {
    setDocument(doc: PDFDocumentProxy | null, selectedIndex: number): void;
    setSelected(index: number): void;
  };
  messages: { show(text: string): void; hide(): void };
  setBusy?(busy: boolean): void;
  log?: Pick<Console, "error" | "warn">;
}

export interface OpenDocument {
  pdf: LoadedPdf;
  state: DocumentState;
}

export interface App {
  handleToolbarAction(action: ToolbarAction): void;
  /** Opens a PDF via the native dialog. Any failure keeps the current document. */
  openPdf(): Promise<void>;
  selectPage(pageIndex: number): void;
  getDocument(): OpenDocument | null;
}

export function createApp(deps: AppDeps): App {
  const log = deps.log ?? console;
  let current: OpenDocument | null = null;
  let opening = false;

  function selectPage(pageIndex: number): void {
    if (!current) return;
    const index = clampPageIndex(current.state, pageIndex);
    current.state.selectedPageIndex = index;
    deps.thumbnails.setSelected(index);
    deps.pageView.showPage(index);
  }

  async function openPdf(): Promise<void> {
    if (opening) return;
    opening = true;
    deps.toolbar.setEnabled("open", false);
    deps.setBusy?.(true);
    // A new attempt replaces any earlier error, even if it is then cancelled.
    deps.messages.hide();
    try {
      let picked: OpenedPdf | null;
      try {
        picked = await deps.pickPdf();
      } catch (error) {
        // Backend/OS error text is not guaranteed to be German; log it, show ours.
        log.error("open_pdf failed", error);
        deps.messages.show(MESSAGES.readFailed);
        return;
      }
      if (!picked) return; // dialog cancelled: nothing changes, no message

      let pdf: LoadedPdf;
      try {
        pdf = await deps.loadPdfDocument(picked.bytes);
      } catch (error) {
        log.warn("PDF rejected", error);
        deps.messages.show(MESSAGES[classifyLoadError(error)]);
        return;
      }

      try {
        await deps.acceptOpenedPdf();
      } catch (error) {
        log.error("accept_opened_pdf failed", error);
        await pdf.destroy().catch(() => undefined);
        deps.messages.show(MESSAGES.readFailed);
        return;
      }

      const previous = current;
      current = { pdf, state: createDocumentState(picked.name, picked.bytes, pdf.pageCount) };
      deps.toolbar.setDocumentName(picked.name);
      deps.thumbnails.setDocument(pdf.proxy, 0);
      deps.pageView.setDocument(pdf.proxy, 0);
      // The views no longer reference the old document; free its worker resources.
      if (previous) await previous.pdf.destroy().catch(() => undefined);
    } finally {
      opening = false;
      deps.toolbar.setEnabled("open", true);
      deps.setBusy?.(false);
    }
  }

  return {
    handleToolbarAction(action) {
      if (action === "open") void openPdf();
    },
    openPdf,
    selectPage,
    getDocument: () => current,
  };
}
