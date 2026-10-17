// Thin wiring of the real backend, pdf.js and DOM views into the app flow (src/app.ts).

import { createApp, signatureWarning, type App } from "./app";
import { acceptOpenedPdf, pickPdf, pickSignaturePng, savePdf } from "./backend";
import { loadPdfDocument } from "./pdf/document";
import { buildSignedPdf } from "./pdf/save";
import { setupPdfjs } from "./pdf/setup";
import { loadBundledFont } from "./placeDate/font";
import { createConfirmDialog } from "./ui/confirmDialog";
import { createMessageBar } from "./ui/messageBar";
import { shortcutFor } from "./ui/keyboard";
import { createOverlay } from "./ui/overlay";
import { createPageView } from "./ui/pageView";
import { createThumbnailStrip } from "./ui/thumbnails";
import { createToolbar } from "./ui/toolbar";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} missing from index.html`);
  return element as T;
}

/** Lets the webview decode the PNG, so files it cannot show are refused up front. */
async function decodePng(bytes: Uint8Array): Promise<void> {
  const bitmap = await createImageBitmap(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
  );
  bitmap.close();
}

setupPdfjs();

const messages = createMessageBar(byId("message"), byId("message-text"), byId("message-close"));

// The views call back into the app, which is created right after them.
let app: App;
const toolbar = createToolbar(byId("toolbar"), (action) => app.handleToolbarAction(action));
const pageViewElement = byId("page-view");
const pageStage = byId("page-stage");
const pageView = createPageView(pageViewElement, byId("empty-hint"), pageStage);
const thumbnails = createThumbnailStrip(byId("thumbnails"), (index) => app.selectPage(index));
const overlay = createOverlay(pageStage, pageViewElement, {
  select: (id) => app.selectElement(id),
  update: (id, geometry) => app.updateElement(id, geometry),
  remove: (id) => app.removeElement(id),
  editPlaceDate: (id) => app.editPlaceDate(id),
  commitPlaceDate: (id, place, date) => void app.commitPlaceDate(id, place, date),
  cancelPlaceDate: (id) => app.cancelPlaceDate(id),
});
pageView.onViewportShown((shown) => overlay.setShownPage(shown));
const discardDialog = createConfirmDialog(byId<HTMLDialogElement>("discard-dialog"));
const signaturesDialog = createConfirmDialog(byId<HTMLDialogElement>("signatures-dialog"));

app = createApp({
  pickPdf,
  acceptOpenedPdf,
  loadPdfDocument,
  pickSignaturePng,
  decodePng,
  loadPlaceDateFont: loadBundledFont,
  buildSignedPdf,
  savePdf,
  confirmDiscard: () => discardDialog.ask(),
  confirmInvalidateSignatures: (count) => signaturesDialog.ask(signatureWarning(count)),
  toolbar,
  pageView,
  thumbnails,
  overlay,
  messages,
  setBusy: (busy) => {
    if (busy) document.body.setAttribute("aria-busy", "true");
    else document.body.removeAttribute("aria-busy");
  },
});

document.addEventListener("keydown", (event) => {
  const shortcut = shortcutFor(event);
  if (shortcut && app.handleShortcut(shortcut)) event.preventDefault();
});
