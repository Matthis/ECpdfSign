// Application flow: opening a PDF, selecting pages and placing signatures.
// DOM-free so it can be unit-tested with fakes; src/main.ts wires it to the
// real backend and views.

import type { OpenedPdf } from "./backend";
import {
  addImage,
  addSignature,
  clampPageIndex,
  createDocumentState,
  getElement,
  getSelectedElement,
  removeElement as removeFromModel,
  selectElement as selectInModel,
  updateElementGeometry,
  type DocumentState,
} from "./model";
import { classifyLoadError, type LoadedPdf } from "./pdf/document";
import type { PDFDocumentProxy } from "./pdf/pdfjs";
import type { PageViewport } from "./pdf/viewport";
import { readPngInfo } from "./signature/png";
import { boxToGeometry, defaultPlacement, type ElementGeometry } from "./ui/geometry";
import type { Shortcut } from "./ui/keyboard";
import type { ShownPage } from "./ui/pageView";
import type { ToolbarAction } from "./ui/toolbar";

export const MESSAGES = {
  encrypted:
    "Passwortgeschützte oder verschlüsselte PDF-Dateien werden noch nicht unterstützt.",
  invalid: "Die Datei konnte nicht als PDF geöffnet werden.",
  readFailed: "Die Datei konnte nicht gelesen werden.",
  invalidPng: "Die Datei konnte nicht als PNG-Bild geladen werden.",
} as const;

export interface AppDeps {
  pickPdf(): Promise<OpenedPdf | null>;
  acceptOpenedPdf(): Promise<void>;
  loadPdfDocument(bytes: Uint8Array): Promise<LoadedPdf>;
  /** Native PNG dialog; `null` if cancelled. */
  pickSignaturePng(): Promise<Uint8Array | null>;
  /**
   * Optional full decode of a PNG that passed the structural check (the real
   * app lets the webview decode it); rejects if the image cannot be shown.
   */
  decodePng?(bytes: Uint8Array): Promise<void>;
  /** Asks "Platzierte Elemente verwerfen?"; resolves `true` for "Verwerfen". */
  confirmDiscard(): Promise<boolean>;
  toolbar: {
    setEnabled(action: ToolbarAction, enabled: boolean): void;
    setDocumentName(name: string | null): void;
  };
  /** Contract: `setDocument` shows `pageIndex` of the new document. */
  pageView: {
    setDocument(doc: PDFDocumentProxy | null, pageIndex: number): void;
    showPage(pageIndex: number): void;
    getShownPage(): ShownPage | null;
  };
  /** Contract: `setDocument` rebuilds the strip, marks `selectedIndex` and scrolls to the top. */
  thumbnails: {
    setDocument(doc: PDFDocumentProxy | null, selectedIndex: number): void;
    setSelected(index: number): void;
  };
  /** Contract: `sync` redraws the placed elements from the model; a new state object means a new document. */
  overlay: { sync(state: DocumentState | null): void };
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
  /**
   * Opens a PDF via the native dialog. Any failure keeps the current document.
   * With elements placed it asks first; "Abbrechen" changes nothing.
   */
  openPdf(): Promise<void>;
  selectPage(pageIndex: number): void;
  /** Loads a PNG via the native dialog and places it, selected, on the current page. */
  insertSignature(): Promise<void>;
  /** Selects an element, or nothing with `null`. */
  selectElement(id: string | null): void;
  /** Stores new geometry for an element (from the overlay while the user drags). */
  updateElement(id: string, geometry: ElementGeometry): void;
  removeElement(id: string): void;
  /** Handles a keyboard shortcut; returns `true` if it did something. */
  handleShortcut(shortcut: Shortcut): boolean;
  getDocument(): OpenDocument | null;
}

export function createApp(deps: AppDeps): App {
  const log = deps.log ?? console;
  let current: OpenDocument | null = null;
  let opening = false;
  let inserting = false;
  let confirming = false;

  /** While another PDF is being opened, the shown document is about to be discarded: leave it alone. */
  function editable(): boolean {
    return !!current && !opening;
  }

  function refreshToolbar(): void {
    deps.toolbar.setEnabled("insertSignature", editable() && !inserting);
    deps.toolbar.setEnabled(
      "removeElement",
      editable() && current!.state.selectedElementId !== null,
    );
  }

  /** Redraws the overlay and the toolbar after any change to elements or selection. */
  function changed(): void {
    deps.overlay.sync(current?.state ?? null);
    refreshToolbar();
  }

  function selectPage(pageIndex: number): void {
    if (!current) return;
    const index = clampPageIndex(current.state, pageIndex);
    current.state.selectedPageIndex = index;
    // A selection on another page would be invisible yet removable: drop it.
    if (getSelectedElement(current.state)?.pageIndex !== index) {
      selectInModel(current.state, null);
    }
    deps.thumbnails.setSelected(index);
    deps.pageView.showPage(index);
    changed();
  }

  async function openPdf(): Promise<void> {
    if (opening) return;
    opening = true;
    refreshToolbar();
    deps.toolbar.setEnabled("open", false);
    try {
      if (current && current.state.elements.length > 0) {
        confirming = true;
        let discard: boolean;
        try {
          discard = await deps.confirmDiscard();
        } finally {
          confirming = false;
        }
        if (!discard) return; // "Abbrechen": nothing changes, no file dialog
      }
      await pickAndOpen();
    } finally {
      opening = false;
      refreshToolbar();
      deps.toolbar.setEnabled("open", true);
    }
  }

  async function pickAndOpen(): Promise<void> {
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
      changed();
      // The views no longer reference the old document; free its worker resources.
      if (previous) await previous.pdf.destroy().catch(() => undefined);
    } finally {
      deps.setBusy?.(false);
    }
  }

  /**
   * Viewport of the page as shown or, if it is not drawn yet, the page at
   * scale 1. The default placement is page-relative, so both give the same
   * PDF geometry.
   */
  async function viewportFor(doc: OpenDocument, pageIndex: number): Promise<PageViewport> {
    const shown = deps.pageView.getShownPage();
    if (shown && shown.pageIndex === pageIndex) return shown.viewport;
    const page = await doc.pdf.proxy.getPage(pageIndex + 1);
    return page.getViewport({ scale: 1 });
  }

  async function insertSignature(): Promise<void> {
    const doc = current;
    if (!doc || inserting || opening) return;
    inserting = true;
    refreshToolbar();
    deps.messages.hide();
    try {
      let bytes: Uint8Array | null;
      try {
        bytes = await deps.pickSignaturePng();
      } catch (error) {
        log.error("pick_signature_png failed", error);
        deps.messages.show(MESSAGES.readFailed);
        return;
      }
      if (!bytes) return; // dialog cancelled: nothing changes, no message

      let size: { width: number; height: number };
      try {
        size = readPngInfo(bytes);
        await deps.decodePng?.(bytes);
      } catch (error) {
        log.warn("PNG rejected", error);
        deps.messages.show(MESSAGES.invalidPng);
        return;
      }

      // Another document may have been opened meanwhile.
      if (current !== doc) return;
      const pageIndex = doc.state.selectedPageIndex;
      const viewport = await viewportFor(doc, pageIndex);
      if (current !== doc) return;

      const box = defaultPlacement(viewport, size.width, size.height);
      const imageId = addImage(doc.state, bytes, size.width, size.height);
      const element = addSignature(doc.state, {
        pageIndex,
        imageId,
        ...boxToGeometry(viewport, box),
      });
      selectInModel(doc.state, element.id);
    } catch (error) {
      log.error("inserting the signature failed", error);
      deps.messages.show(MESSAGES.invalidPng);
    } finally {
      inserting = false;
      changed();
    }
  }

  function selectElement(id: string | null): void {
    if (!current) return;
    // Only elements of the current page can be selected; another page's
    // element (e.g. clicked before the new page rendered) would be invisible.
    if (id !== null && getElement(current.state, id)?.pageIndex !== current.state.selectedPageIndex) {
      return;
    }
    selectInModel(current.state, id);
    changed();
  }

  function updateElement(id: string, geometry: ElementGeometry): void {
    if (!current) return;
    if (updateElementGeometry(current.state, id, geometry.rect, geometry.rotation)) changed();
  }

  function removeElement(id: string): void {
    if (!editable() || !getElement(current!.state, id)) return;
    removeFromModel(current!.state, id);
    changed();
  }

  function removeSelected(): boolean {
    const id = current?.state.selectedElementId;
    if (!id) return false;
    removeElement(id);
    return true;
  }

  return {
    handleToolbarAction(action) {
      if (action === "open") void openPdf();
      else if (action === "insertSignature") void insertSignature();
      else if (action === "removeElement") removeSelected();
    },
    openPdf,
    selectPage,
    insertSignature,
    selectElement,
    updateElement,
    removeElement,
    handleShortcut(shortcut) {
      if (confirming || !editable() || !current) return false;
      if (shortcut === "removeElement") return removeSelected();
      if (current.state.selectedElementId === null) return false;
      selectElement(null);
      return true;
    },
    getDocument: () => current,
  };
}
