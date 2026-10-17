// Thin wiring of the real backend, pdf.js and DOM views into the app flow (src/app.ts).

import { createApp, type App } from "./app";
import { acceptOpenedPdf, pickPdf } from "./backend";
import { loadPdfDocument } from "./pdf/document";
import { setupPdfjs } from "./pdf/setup";
import { createPageView } from "./ui/pageView";
import { createThumbnailStrip } from "./ui/thumbnails";
import { createToolbar } from "./ui/toolbar";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} missing from index.html`);
  return element as T;
}

setupPdfjs();

const messageBar = byId("message");
const messageText = byId("message-text");
const messages = {
  show(text: string): void {
    messageText.textContent = text;
    messageBar.hidden = false;
  },
  hide(): void {
    messageBar.hidden = true;
    messageText.textContent = "";
  },
};
byId("message-close").addEventListener("click", messages.hide);

// The views call back into the app, which is created right after them.
let app: App;
const toolbar = createToolbar(byId("toolbar"), (action) => app.handleToolbarAction(action));
const pageView = createPageView(byId("page-view"), byId("empty-hint"), byId("page-stage"));
const thumbnails = createThumbnailStrip(byId("thumbnails"), (index) => app.selectPage(index));

app = createApp({
  pickPdf,
  acceptOpenedPdf,
  loadPdfDocument,
  toolbar,
  pageView,
  thumbnails,
  messages,
  setBusy: (busy) => {
    if (busy) document.body.setAttribute("aria-busy", "true");
    else document.body.removeAttribute("aria-busy");
  },
});
