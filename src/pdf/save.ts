// Builds the signed copy of a document with pdf-lib. Pure: no DOM, no pdf.js
// calls (the page viewports are passed in). The source bytes are never
// modified; pdf-lib works on a copy.

import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { PlacedElement, StoredImage } from "../model";
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
 * and the image (a unit square) is drawn with the matrix that takes its
 * corners (0,0), (1,0), (0,1) to the screen's sw, se and nw corners. The
 * page's /Rotate, its CropBox origin and the element's own rotation are all in
 * those three points, so no other compensation is needed.
 *
 * - `pageViewports` must hold a pdf.js viewport (any scale; scale 1 is used by
 *   the app) for every page that has an element.
 * - Each image is embedded once and referenced by every placement.
 * - Everything else (pages, content, annotations, document metadata) stays as
 *   it was; existing page content is wrapped in q/Q by pdf-lib so a CTM it
 *   leaves behind does not affect the drawn images.
 */
export async function buildSignedPdf(
  sourceBytes: Uint8Array,
  elements: readonly PlacedElement[],
  images: ReadonlyMap<string, StoredImage>,
  pageViewports: ReadonlyMap<number, PageViewport>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
  const embedded = new Map<string, PDFImage>();
  const touchedPages = new Set<number>();
  /** Resource name of an image on a page, keyed by `${pageIndex}:${imageId}`. */
  const resourceNames = new Map<string, PDFName>();

  for (const element of elements) {
    if (element.kind !== "signature") {
      throw new Error(`saving ${element.kind} elements is not supported yet`);
    }
    const viewport = pageViewports.get(element.pageIndex);
    if (!viewport) throw new Error(`no viewport for page ${element.pageIndex}`);
    const page = doc.getPage(element.pageIndex);
    if (!touchedPages.has(element.pageIndex)) {
      touchedPages.add(element.pageIndex);
      unshareContents(page);
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

    const [nw, , se, sw] = boxCorners(boxFromGeometry(viewport, element)).map((p) =>
      toPdfPoint(viewport, p),
    );
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(se.x - sw.x, se.y - sw.y, nw.x - sw.x, nw.y - sw.y, sw.x, sw.y),
      drawObject(name),
      popGraphicsState(),
    );
  }

  // Classic xref table rather than object streams: readable by every viewer,
  // whatever PDF version the source declares.
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
