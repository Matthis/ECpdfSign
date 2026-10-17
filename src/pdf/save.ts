// Builds the signed copy of a document with pdf-lib. Pure: no DOM, no pdf.js
// calls (the page viewports are passed in). The source bytes are never
// modified; pdf-lib works on a copy.

import {
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  moveText,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  setFillingGrayscaleColor,
  setFontAndSize,
  showText,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from "pdf-lib";
import type { PlacedElement, StoredImage } from "../model";
import { formatPlaceDate } from "../placeDate/format";
import {
  baselineOffset,
  createPlaceDateFont,
  loadFontkit,
  TEXT_FEATURES,
  textBoxSize,
  type PlaceDateFont,
} from "../placeDate/metrics";
import { boxCorners, boxFromGeometry } from "../ui/geometry";
import { toPdfPoint, type PageViewport } from "./viewport";

/**
 * pdf-lib wraps and appends to a page's /Contents array in place. If that array
 * is an indirect object shared by several pages, every one of them would get
 * the signature, so the page gets its own direct copy first.
 */
function unshareContents(page: PDFPage): void {
  const contents = page.node.get(PDFName.of("Contents"));
  if (!(contents instanceof PDFRef)) return;
  const array = page.doc.context.lookup(contents);
  if (array instanceof PDFArray) page.node.set(PDFName.of("Contents"), array.clone());
}

/**
 * Returns a new PDF: the source document with every placed element drawn on
 * top of its page, exactly where the preview shows it.
 *
 * The placement goes through the same pdf.js viewport conversion as the
 * preview: the element's on-screen corners are mapped back to PDF user space,
 * and the element is drawn with the matrix that takes its local box corners
 * (0,0), (w,0), (0,h) to the screen's sw, se and nw corners. The page's
 * /Rotate, its CropBox origin and the element's own rotation are all in
 * those three points, so no other compensation is needed.
 * - An image's local box is the unit square.
 * - A place/date text's local box is its text box in points at its font size
 *   (see placeDate/metrics.ts); the text is drawn in it at x = 0 on the
 *   baseline, which lies `-descent` above the box's bottom edge.
 *
 * - `pageViewports` must hold a pdf.js viewport (any scale; scale 1 is used by
 *   the app) for every page that has an element.
 * - Each image is embedded once and referenced by every placement.
 * - `fontBytes` (the bundled place/date font) is required when there are
 *   texts. It is embedded once, as a subset, and the text is black.
 * - Everything else (pages, content, annotations, document metadata) stays as
 *   it was; existing page content is wrapped in q/Q by pdf-lib so a CTM it
 *   leaves behind does not affect the drawn images.
 */
export async function buildSignedPdf(
  sourceBytes: Uint8Array,
  elements: readonly PlacedElement[],
  images: ReadonlyMap<string, StoredImage>,
  pageViewports: ReadonlyMap<number, PageViewport>,
  fontBytes?: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
  const embedded = new Map<string, PDFImage>();
  const touchedPages = new Set<number>();
  /** Resource name of an image on a page, keyed by `${pageIndex}:${imageId}`. */
  const resourceNames = new Map<string, PDFName>();
  /** Resource name of the text font on a page. */
  const fontNames = new Map<number, PDFName>();
  let text: { font: PDFFont; placeDateFont: PlaceDateFont } | null = null;

  for (const element of elements) {
    const viewport = pageViewports.get(element.pageIndex);
    if (!viewport) throw new Error(`no viewport for page ${element.pageIndex}`);
    const page = doc.getPage(element.pageIndex);
    if (!touchedPages.has(element.pageIndex)) {
      touchedPages.add(element.pageIndex);
      unshareContents(page);
    }
    const [nw, , se, sw] = boxCorners(boxFromGeometry(viewport, element)).map((p) =>
      toPdfPoint(viewport, p),
    );
    /** Maps the local box w x h onto the preview's corners. */
    const placeBox = (w: number, h: number): PDFOperator =>
      concatTransformationMatrix(
        (se.x - sw.x) / w,
        (se.y - sw.y) / w,
        (nw.x - sw.x) / h,
        (nw.y - sw.y) / h,
        sw.x,
        sw.y,
      );

    if (element.kind === "placeDate") {
      const content = formatPlaceDate(element.place, element.date);
      if (!content) continue;
      if (!text) {
        if (!fontBytes) throw new Error("no font for place/date texts");
        doc.registerFontkit(await loadFontkit());
        text = {
          font: await doc.embedFont(fontBytes.slice(), { subset: true, features: TEXT_FEATURES }),
          placeDateFont: await createPlaceDateFont(fontBytes),
        };
      }
      let fontName = fontNames.get(element.pageIndex);
      if (!fontName) {
        fontName = page.node.newFontDictionary(text.font.name, text.font.ref);
        fontNames.set(element.pageIndex, fontName);
      }
      const { metrics } = text.placeDateFont;
      const size = textBoxSize(metrics, content, element.fontSize);
      if (!(size.width > 0 && size.height > 0)) continue;
      page.pushOperators(
        pushGraphicsState(),
        placeBox(size.width, size.height),
        setFillingGrayscaleColor(0),
        beginText(),
        setFontAndSize(fontName, element.fontSize),
        moveText(0, baselineOffset(metrics, element.fontSize)),
        showText(text.font.encodeText(content)),
        endText(),
        popGraphicsState(),
      );
      continue;
    }

    let image = embedded.get(element.imageId);
    if (!image) {
      const stored = images.get(element.imageId);
      if (!stored) throw new Error(`unknown image ${element.imageId}`);
      image = await doc.embedPng(stored.bytes);
      embedded.set(element.imageId, image);
    }

    const key = `${element.pageIndex}:${element.imageId}`;
    let name = resourceNames.get(key);
    if (!name) {
      name = page.node.newXObject("Image", image.ref);
      resourceNames.set(key, name);
    }

    page.pushOperators(
      pushGraphicsState(),
      placeBox(1, 1),
      drawObject(name),
      popGraphicsState(),
    );
  }

  // Classic xref table rather than object streams: readable by every viewer,
  // whatever PDF version the source declares.
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
