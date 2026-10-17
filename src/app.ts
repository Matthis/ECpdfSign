// Application flow: opening a PDF, selecting pages, placing signatures and
// place/date texts, and saving.
// DOM-free so it can be unit-tested with fakes; src/main.ts wires it to the
// real backend and views.

import type { OpenedPdf } from "./backend";
import {
  addImage,
  addPlaceDate,
  addSignature,
  clampPageIndex,
  createDocumentState,
  getElement,
  getSelectedElement,
  removeElement as removeFromModel,
  selectElement as selectInModel,
  updateElementGeometry,
  updatePlaceDateText,
  type DocumentState,
  type PlacedElement,
  type StoredImage,
} from "./model";
import { classifyLoadError, type LoadedPdf } from "./pdf/document";
import type { PDFDocumentProxy } from "./pdf/pdfjs";
import type { PageViewport } from "./pdf/viewport";
import { formatPlaceDate, isEmptyPlaceDate, todayDdMmYyyy } from "./placeDate/format";
import { DEFAULT_FONT_SIZE, textBoxSize, type PlaceDateFont } from "./placeDate/metrics";
import { checkPngEmbeddable } from "./signature/pdfEmbed";
import { readPngInfo } from "./signature/png";
import {
  boxFromGeometry,
  boxToGeometry,
  defaultPlacement,
  keepOnPage,
  pdfUnitInPx,
  placeDatePlacement,
  resizeFromTopLeft,
  type ElementGeometry,
} from "./ui/geometry";
import type { Shortcut } from "./ui/keyboard";
import type { ShownPage } from "./ui/pageView";
import type { ToolbarAction } from "./ui/toolbar";

export const MESSAGES = {
  encrypted:
    "Passwortgeschützte oder verschlüsselte PDF-Dateien werden noch nicht unterstützt.",
  invalid: "Die Datei konnte nicht als PDF geöffnet werden.",
  readFailed: "Die Datei konnte nicht gelesen werden.",
  invalidPng: "Die Datei konnte nicht als PNG-Bild geladen werden.",
  uneditable: "Diese PDF-Datei kann nicht bearbeitet werden.",
  buildFailed: "Die PDF-Datei konnte nicht erstellt werden.",
  saveFailed:
    "Die Datei konnte nicht gespeichert werden. Ist sie in einem anderen Programm geöffnet oder schreibgeschützt?",
  fontFailed: "Die Schrift für Ort und Datum konnte nicht geladen werden.",
  placeDateFailed: "Ort und Datum konnten nicht eingefügt werden.",
  /** Info notice right after opening a digitally signed PDF. */
  signedPdf: "Dieses PDF ist digital signiert. Beim Speichern werden die Signaturen ungültig.",
} as const;

/** Text of the warning before saving a PDF with `count` (≥ 1) digital signatures. */
export function signatureWarning(count: number): string {
  return count === 1
    ? "Dieses PDF enthält 1 digitale Signatur. Beim Speichern wird sie ungültig."
    : `Dieses PDF enthält ${count} digitale Signaturen. Beim Speichern werden sie ungültig.`;
}

/** Info message after a successful save. */
export function savedMessage(fileName: string): string {
  return `Gespeichert: ${fileName}`;
}

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
  /** The bundled place/date font (file and metrics); loaded once, on the first text. */
  loadPlaceDateFont(): Promise<PlaceDateFont>;
  /** The current time, for today's date; defaults to the system clock. */
  now?(): Date;
  /**
   * Builds the signed copy (see pdf/save.ts); `pageViewports` holds a scale-1
   * viewport per used page, `fontBytes` the place/date font if there are texts.
   */
  buildSignedPdf(
    sourceBytes: Uint8Array,
    elements: readonly PlacedElement[],
    images: ReadonlyMap<string, StoredImage>,
    pageViewports: ReadonlyMap<number, PageViewport>,
    fontBytes: Uint8Array | null,
  ): Promise<Uint8Array>;
  /** Native save dialog plus write; resolves to the saved file name, or `null` if cancelled. */
  savePdf(bytes: Uint8Array): Promise<string | null>;
  /** Asks "Platzierte Elemente verwerfen?"; resolves `true` for "Verwerfen". */
  confirmDiscard(): Promise<boolean>;
  /**
   * Warns that saving invalidates the PDF's `count` digital signatures (see
   * `signatureWarning`); resolves `true` for "Trotzdem speichern", `false`
   * for "Abbrechen" or Esc.
   */
  confirmInvalidateSignatures(count: number): Promise<boolean>;
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
  /**
   * Contract: `sync` redraws the placed elements from the model, including
   * the inline editor of `state.editingElementId`; a new state object means a
   * new document.
   */
  overlay: { sync(state: DocumentState | null): void };
  /** `show` is an error, `info` a neutral notice (e.g. after saving). */
  messages: { show(text: string): void; info(text: string): void; hide(): void };
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
  /**
   * Adds a "<today>" text on the current page (below or beside the selected
   * signature, else centered), selected and straight in edit mode.
   */
  insertPlaceDate(): Promise<void>;
  /** Opens the inline editor of a place/date text (double-click). */
  editPlaceDate(id: string): void;
  /**
   * Ends editing with the given parts (`date` as DD.MM.YYYY or empty). The
   * text keeps its top-left corner; with both parts empty it is removed.
   * Applied at once when the text's page is shown (always, in the app);
   * otherwise once the page's viewport is loaded, which the promise awaits.
   */
  commitPlaceDate(id: string, place: string, date: string): Promise<void>;
  /** Ends editing without a change (Esc): the text keeps its values from before. */
  cancelPlaceDate(id: string): void;
  /** Selects an element, or nothing with `null`. */
  selectElement(id: string | null): void;
  /** Stores new geometry for an element (from the overlay while the user drags). */
  updateElement(id: string, geometry: ElementGeometry): void;
  removeElement(id: string): void;
  /**
   * Builds the signed PDF from the unchanged source bytes and every placed
   * element, then hands it to the backend's save dialog. The placed elements
   * stay as they are and can be saved again. If the PDF is digitally signed,
   * it first warns that saving invalidates the signatures (once per opened
   * document); "Abbrechen" changes nothing.
   */
  save(): Promise<void>;
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
  let saving = false;
  /** Whether the bar shows the "Gespeichert" notice, which goes stale on the next element change. */
  let savedNoticeShown = false;
  let fontRequest: Promise<PlaceDateFont> | null = null;
  /** The place/date font once loaded; every text was inserted after that. */
  let font: PlaceDateFont | null = null;

  /** Loads the place/date font once; a failed load is retried next time. */
  function placeDateFont(): Promise<PlaceDateFont> {
    fontRequest ??= deps.loadPlaceDateFont().then(
      (loaded) => (font = loaded),
      (error: unknown) => {
        fontRequest = null;
        throw error;
      },
    );
    return fontRequest;
  }

  // Every message goes through here, so `savedNoticeShown` stays accurate.
  const messages = {
    show(text: string): void {
      savedNoticeShown = false;
      deps.messages.show(text);
    },
    info(text: string): void {
      savedNoticeShown = false;
      deps.messages.info(text);
    },
    /** The "Gespeichert" notice, which goes stale on the next element change. */
    saved(text: string): void {
      savedNoticeShown = true;
      deps.messages.info(text);
    },
    hide(): void {
      savedNoticeShown = false;
      deps.messages.hide();
    },
  };

  /** After an element changed, the document no longer matches the saved file. */
  function dropSavedNotice(): void {
    if (savedNoticeShown) messages.hide();
  }

  /**
   * While another PDF is being opened, the shown document is about to be
   * discarded; while it is being saved, it is in use. Leave it alone either way.
   */
  function editable(): boolean {
    return !!current && !opening && !saving;
  }

  function refreshToolbar(): void {
    deps.toolbar.setEnabled("insertPlaceDate", editable() && !inserting);
    deps.toolbar.setEnabled("insertSignature", editable() && !inserting);
    deps.toolbar.setEnabled(
      "save",
      editable() && !inserting && current!.state.elements.length > 0,
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
    const editing = current.state.editingElementId;
    if (editing !== null && getElement(current.state, editing)?.pageIndex !== index) {
      current.state.editingElementId = null;
    }
    deps.thumbnails.setSelected(index);
    deps.pageView.showPage(index);
    changed();
  }

  async function openPdf(): Promise<void> {
    if (opening || saving) return;
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
    messages.hide();
    try {
      let picked: OpenedPdf | null;
      try {
        picked = await deps.pickPdf();
      } catch (error) {
        // Backend/OS error text is not guaranteed to be German; log it, show ours.
        log.error("open_pdf failed", error);
        messages.show(MESSAGES.readFailed);
        return;
      }
      if (!picked) return; // dialog cancelled: nothing changes, no message

      let pdf: LoadedPdf;
      try {
        pdf = await deps.loadPdfDocument(picked.bytes);
      } catch (error) {
        log.warn("PDF rejected", error);
        messages.show(MESSAGES[classifyLoadError(error)]);
        return;
      }

      try {
        await deps.acceptOpenedPdf();
      } catch (error) {
        log.error("accept_opened_pdf failed", error);
        await pdf.destroy().catch(() => undefined);
        messages.show(MESSAGES.readFailed);
        return;
      }

      const previous = current;
      current = {
        pdf,
        state: createDocumentState(picked.name, picked.bytes, pdf.pageCount, pdf.signedSignatureCount),
      };
      deps.toolbar.setDocumentName(picked.name);
      deps.thumbnails.setDocument(pdf.proxy, 0);
      deps.pageView.setDocument(pdf.proxy, 0);
      changed();
      if (pdf.signedSignatureCount > 0) messages.info(MESSAGES.signedPdf);
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
    if (!doc || inserting || !editable()) return;
    inserting = true;
    refreshToolbar();
    messages.hide();
    try {
      let bytes: Uint8Array | null;
      try {
        bytes = await deps.pickSignaturePng();
      } catch (error) {
        log.error("pick_signature_png failed", error);
        messages.show(MESSAGES.readFailed);
        return;
      }
      if (!bytes) return; // dialog cancelled: nothing changes, no message

      let size: { width: number; height: number };
      try {
        size = readPngInfo(bytes);
        await deps.decodePng?.(bytes);
        // Saving embeds it with pdf-lib; refuse now what could not be saved later.
        await checkPngEmbeddable(bytes);
      } catch (error) {
        log.warn("PNG rejected", error);
        messages.show(MESSAGES.invalidPng);
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
      messages.show(MESSAGES.invalidPng);
    } finally {
      inserting = false;
      changed();
    }
  }

  async function insertPlaceDate(): Promise<void> {
    const doc = current;
    if (!doc || inserting || !editable()) return;
    inserting = true;
    refreshToolbar();
    messages.hide();
    const pageIndex = doc.state.selectedPageIndex;
    // Another document or page meanwhile: the text would open in edit mode where it is not shown.
    const stale = () => current !== doc || doc.state.selectedPageIndex !== pageIndex;
    try {
      let loaded: PlaceDateFont;
      try {
        loaded = await placeDateFont();
      } catch (error) {
        log.error("loading the place/date font failed", error);
        messages.show(MESSAGES.fontFailed);
        return;
      }
      if (stale()) return;
      const viewport = await viewportFor(doc, pageIndex);
      if (stale()) return;

      // The place starts empty on every insert; the date is today.
      const place = "";
      const date = todayDdMmYyyy(deps.now?.() ?? new Date());
      const size = textBoxSize(loaded.metrics, formatPlaceDate(place, date), DEFAULT_FONT_SIZE);
      const px = pdfUnitInPx(viewport);
      const selected = getSelectedElement(doc.state);
      const signature =
        selected?.kind === "signature" && selected.pageIndex === pageIndex
          ? boxFromGeometry(viewport, selected)
          : null;
      const box = placeDatePlacement(
        viewport,
        { width: size.width * px, height: size.height * px },
        signature,
      );
      const element = addPlaceDate(doc.state, {
        pageIndex,
        place,
        date,
        fontSize: DEFAULT_FONT_SIZE,
        ...boxToGeometry(viewport, box),
      });
      selectInModel(doc.state, element.id);
      doc.state.editingElementId = element.id;
    } catch (error) {
      log.error("inserting the place/date text failed", error);
      messages.show(MESSAGES.placeDateFailed);
    } finally {
      inserting = false;
      changed();
    }
  }

  function editPlaceDate(id: string): void {
    // While a text is being inserted, it is about to take over the editor.
    if (!current || !editable() || inserting) return;
    const element = getElement(current.state, id);
    if (element?.kind !== "placeDate" || element.pageIndex !== current.state.selectedPageIndex) {
      return;
    }
    selectInModel(current.state, id);
    current.state.editingElementId = id;
    changed();
  }

  function cancelPlaceDate(id: string): void {
    if (!current) return;
    if (current.state.editingElementId === id) current.state.editingElementId = null;
    changed();
  }

  function commitPlaceDate(id: string, place: string, date: string): Promise<void> {
    const doc = current;
    if (!doc) return Promise.resolve();
    if (doc.state.editingElementId === id) doc.state.editingElementId = null;
    const element = getElement(doc.state, id);
    // NFC, so a decomposed "ó" (o + combining accent) is one glyph, as in the preview.
    const newPlace = place.normalize("NFC").trim();
    const newDate = date.normalize("NFC").trim();
    if (element?.kind !== "placeDate" || (newPlace === element.place && newDate === element.date)) {
      changed();
      return Promise.resolve();
    }
    if (isEmptyPlaceDate(newPlace, newDate)) {
      removeFromModel(doc.state, id);
      dropSavedNotice();
      changed();
      return Promise.resolve();
    }

    // The box follows the text; its top-left corner stays where it is.
    const apply = (viewport: PageViewport): void => {
      const target = getElement(doc.state, id);
      if (current !== doc || target?.kind !== "placeDate" || !font) return;
      const size = textBoxSize(font.metrics, formatPlaceDate(newPlace, newDate), target.fontSize);
      const px = pdfUnitInPx(viewport);
      const page = { width: viewport.width, height: viewport.height };
      const box = keepOnPage(
        resizeFromTopLeft(boxFromGeometry(viewport, target), size.width * px, size.height * px),
        page,
      );
      updatePlaceDateText(doc.state, id, newPlace, newDate, boxToGeometry(viewport, box).rect);
      dropSavedNotice();
      changed();
    };
    const shown = deps.pageView.getShownPage();
    if (shown && shown.pageIndex === element.pageIndex) {
      apply(shown.viewport);
      return Promise.resolve();
    }
    changed();
    return viewportFor(doc, element.pageIndex).then(apply, (error: unknown) =>
      log.error("updating the place/date text failed", error),
    );
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
    if (
      updateElementGeometry(current.state, id, geometry.rect, geometry.rotation, geometry.fontSize)
    ) {
      dropSavedNotice();
      changed();
    }
  }

  function removeElement(id: string): void {
    if (!editable() || !getElement(current!.state, id)) return;
    removeFromModel(current!.state, id);
    dropSavedNotice();
    changed();
  }

  async function save(): Promise<void> {
    const doc = current;
    // While a PNG is being inserted, saving now would miss it.
    if (!doc || !editable() || inserting || doc.state.elements.length === 0) return;
    saving = true;
    refreshToolbar();
    deps.toolbar.setEnabled("open", false);
    try {
      // Rewriting the file invalidates existing digital signatures: ask first,
      // before anything is built or the save dialog opens. Asked once per
      // opened document; after "Abbrechen" the next save asks again.
      if (doc.state.signedSignatureCount > 0 && !doc.state.signatureWarningAccepted) {
        confirming = true;
        let proceed: boolean;
        try {
          proceed = await deps.confirmInvalidateSignatures(doc.state.signedSignatureCount);
        } catch (error) {
          log.error("signature warning failed", error);
          proceed = false;
        } finally {
          confirming = false;
        }
        if (!proceed) return; // "Abbrechen": nothing built or written, no message
        doc.state.signatureWarningAccepted = true;
      }

      deps.setBusy?.(true);
      messages.hide();

      // Saved as they are now, even if they change while the file is built.
      const elements = doc.state.elements.map((e) => ({ ...e, rect: { ...e.rect } }));
      const images = new Map(doc.state.images);

      let bytes: Uint8Array;
      try {
        const viewports = new Map<number, PageViewport>();
        for (const pageIndex of new Set(elements.map((e) => e.pageIndex))) {
          const page = await doc.pdf.proxy.getPage(pageIndex + 1);
          viewports.set(pageIndex, page.getViewport({ scale: 1 }));
        }
        let fontBytes: Uint8Array | null = null;
        if (elements.some((e) => e.kind === "placeDate")) {
          try {
            fontBytes = (await placeDateFont()).bytes;
          } catch (error) {
            log.error("loading the place/date font failed", error);
            messages.show(MESSAGES.fontFailed);
            return;
          }
        }
        bytes = await deps.buildSignedPdf(doc.state.sourceBytes, elements, images, viewports, fontBytes);
      } catch (error) {
        log.error("building the signed PDF failed", error);
        messages.show(MESSAGES.buildFailed);
        return;
      }

      let savedName: string | null;
      try {
        savedName = await deps.savePdf(bytes);
      } catch (error) {
        // Backend/OS error text is not guaranteed to be German; log it, show ours.
        log.error("save_pdf failed", error);
        messages.show(MESSAGES.saveFailed);
        return;
      }
      if (savedName === null) return; // dialog cancelled: nothing written, no message
      messages.saved(savedMessage(savedName));
    } finally {
      saving = false;
      deps.setBusy?.(false);
      deps.toolbar.setEnabled("open", true);
      refreshToolbar();
    }
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
      else if (action === "insertPlaceDate") void insertPlaceDate();
      else if (action === "insertSignature") void insertSignature();
      else if (action === "save") void save();
    },
    openPdf,
    selectPage,
    insertSignature,
    insertPlaceDate,
    editPlaceDate,
    commitPlaceDate,
    cancelPlaceDate,
    selectElement,
    updateElement,
    removeElement,
    save,
    handleShortcut(shortcut) {
      if (confirming || !editable() || !current) return false;
      // The inline editor handles its own keys.
      if (current.state.editingElementId !== null) return false;
      if (shortcut === "removeElement") return removeSelected();
      if (current.state.selectedElementId === null) return false;
      selectElement(null);
      return true;
    },
    getDocument: () => current,
  };
}
