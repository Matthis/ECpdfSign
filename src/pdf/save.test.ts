// Round trip: build source PDFs with pdf-lib, place signatures as the preview
// would, save, and read each drawn image's transform back with pdf.js.

import {
  concatTransformationMatrix,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  rgb,
} from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import type { PlaceDateElement, SignatureElement, StoredImage } from "../model";
import { formatPlaceDate } from "../placeDate/format";
import { bundledFont, FONT_BYTES } from "../placeDate/fontFixture.test-data";
import { textBoxSize } from "../placeDate/metrics";
import { makePng } from "../signature/pngFixtures.test-data";
import {
  boxCorners,
  boxFromGeometry,
  boxToGeometry,
  pdfUnitInPx,
  type Box,
  type Point,
} from "../ui/geometry";
import { getDocument, OPS, type PDFDocumentProxy } from "./pdfjs";
import { buildSignedPdf } from "./save";
import { toViewportPoint, type PageViewport } from "./viewport";

/** Scale of the simulated preview; saving uses scale-1 viewports, so this also checks scale independence. */
const PREVIEW_SCALE = 1.37;

interface PageSpec {
  rotate: 0 | 90 | 180 | 270;
  /** CropBox [x, y, width, height]; MediaBox is 595 x 842. */
  crop?: [number, number, number, number];
  /** Leave a non-identity CTM at the end of the page's content. */
  leaveCtm?: boolean;
}

async function makeSource(pages: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0.2, 0.4, 0.8) });
    if (spec.crop) page.setCropBox(...spec.crop);
    page.setRotation(degrees(spec.rotate));
    if (spec.leaveCtm) page.pushOperators(concatTransformationMatrix(2, 0.3, -0.1, 1.5, 40, -25));
  }
  return doc.save({ useObjectStreams: false });
}

const tasks: Array<ReturnType<typeof getDocument>> = [];
afterEach(async () => {
  for (const task of tasks.splice(0)) await task.destroy().catch(() => undefined);
});

async function openWithPdfjs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = getDocument({ data: bytes.slice() });
  tasks.push(task);
  return task.promise;
}

async function viewports(doc: PDFDocumentProxy, scale: number): Promise<Map<number, PageViewport>> {
  const map = new Map<number, PageViewport>();
  for (let i = 0; i < doc.numPages; i++) {
    map.set(i, (await doc.getPage(i + 1)).getViewport({ scale }));
  }
  return map;
}

const PNG = makePng(300, 100);
const IMAGES = new Map<string, StoredImage>([
  ["img-1", { id: "img-1", bytes: PNG, width: 300, height: 100 }],
  ["img-2", { id: "img-2", bytes: makePng(40, 60), width: 40, height: 60 }],
]);

let nextId = 1;
/** A signature placed where the preview shows `box` on `viewport`. */
function placed(viewport: PageViewport, pageIndex: number, box: Box, imageId = "img-1"): SignatureElement {
  return {
    id: `el-${nextId++}`,
    kind: "signature",
    pageIndex,
    imageId,
    ...boxToGeometry(viewport, box),
  };
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  // m applied first, then n (PDF convention: [m] x [n]).
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

interface DrawnImage {
  objId: string;
  /** Full CTM in effect when the image (unit square) is painted. */
  ctm: Matrix;
}

/** Every image painted on a page, with the CTM pdf.js applies to it. */
async function drawnImages(doc: PDFDocumentProxy, pageIndex: number): Promise<DrawnImage[]> {
  const page = await doc.getPage(pageIndex + 1);
  const { fnArray, argsArray } = await page.getOperatorList();
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const drawn: DrawnImage[] = [];
  fnArray.forEach((fn, i) => {
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === OPS.paintImageXObject) drawn.push({ objId: args[0] as string, ctm });
    else if (fn === OPS.paintImageXObjectRepeat) {
      // pdf.js batches repeated upright draws of one image: [id, scaleX, scaleY, positions].
      const [objId, sx, sy, positions] = args as [string, number, number, number[]];
      for (let p = 0; p < positions.length; p += 2) {
        drawn.push({ objId, ctm: multiply([sx, 0, 0, sy, positions[p], positions[p + 1]], ctm) });
      }
    }
  });
  return drawn;
}

/** Screen corners (nw, ne, se, sw) of a drawn unit-square image under `viewport`. */
function screenCorners(viewport: PageViewport, ctm: Matrix): Point[] {
  const apply = ([x, y]: [number, number]) => ({
    x: ctm[0] * x + ctm[2] * y + ctm[4],
    y: ctm[1] * x + ctm[3] * y + ctm[5],
  });
  const unit: Array<[number, number]> = [[0, 1], [1, 1], [1, 0], [0, 0]];
  return unit.map((corner) => toViewportPoint(viewport, apply(corner)));
}

function expectCornersClose(actual: Point[], expected: Point[]): void {
  expect(actual).toHaveLength(4);
  actual.forEach((point, i) => {
    expect(Math.abs(point.x - expected[i].x)).toBeLessThan(0.01);
    expect(Math.abs(point.y - expected[i].y)).toBeLessThan(0.01);
  });
}

/** Image XObjects of the saved file, without the soft masks that carry PNG alpha. */
async function imageXObjects(bytes: Uint8Array): Promise<{ images: PDFRawStream[]; masks: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const streams = doc.context
    .enumerateIndirectObjects()
    .filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
    .map(([ref, obj]) => [ref, obj as PDFRawStream] as const);
  const maskRefs = new Set(
    streams
      .map(([, s]) => s.dict.get(PDFName.of("SMask")))
      .filter((r): r is PDFRef => r instanceof PDFRef)
      .map((r) => r.toString()),
  );
  return {
    images: streams.filter(([ref]) => !maskRefs.has(ref.toString())).map(([, s]) => s),
    masks: maskRefs.size,
  };
}

/** Builds, saves and checks every placement against the preview corners. */
async function roundTrip(pages: PageSpec[], boxesPerPage: Box[][]) {
  const source = await makeSource(pages);
  const before = source.slice();
  const sourceDoc = await openWithPdfjs(source);
  const preview = await viewports(sourceDoc, PREVIEW_SCALE);
  const elements = boxesPerPage.flatMap((boxes, pageIndex) =>
    boxes.map((box) => placed(preview.get(pageIndex)!, pageIndex, box)),
  );

  const saved = await buildSignedPdf(source, elements, IMAGES, await viewports(sourceDoc, 1));

  expect(source).toEqual(before);
  const savedDoc = await openWithPdfjs(saved);
  expect(savedDoc.numPages).toBe(pages.length);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const onPage = elements.filter((e) => e.pageIndex === pageIndex);
    const drawn = await drawnImages(savedDoc, pageIndex);
    expect(drawn).toHaveLength(onPage.length);
    const savedViewport = (await savedDoc.getPage(pageIndex + 1)).getViewport({ scale: PREVIEW_SCALE });
    onPage.forEach((element, i) => {
      const expected = boxCorners(boxFromGeometry(preview.get(pageIndex)!, element));
      expectCornersClose(screenCorners(savedViewport, drawn[i].ctm), expected);
    });
  }
  return { saved, elements };
}

describe("buildSignedPdf", () => {
  it("places signatures on a /Rotate 90 page with a CropBox offset at the preview's corners (one rotated 30°)", async () => {
    await roundTrip(
      [{ rotate: 90, crop: [37, 61, 480, 700] }],
      [[
        { cx: 300, cy: 200, width: 220, height: 73, rotation: 0 },
        { cx: 500, cy: 400, width: 180, height: 60, rotation: 30 },
      ]],
    );
  });

  it("matches the preview on /Rotate 0, 90, 180 and 270 pages, with and without CropBox offsets", async () => {
    const pages: PageSpec[] = [
      { rotate: 0 },
      { rotate: 90, crop: [20, 30, 500, 760] },
      { rotate: 180, crop: [11, 13, 560, 800] },
      { rotate: 270, crop: [45, 25, 520, 790] },
      { rotate: 270 },
    ];
    const boxes: Box[] = [
      { cx: 150, cy: 120, width: 200, height: 66, rotation: 0 },
      { cx: 420, cy: 610, width: 150, height: 50, rotation: 30 },
      { cx: 260, cy: 380, width: 90, height: 140, rotation: 247.5 },
    ];
    await roundTrip(pages, pages.map(() => boxes));
  });

  it("is not affected by a CTM the page content leaves behind", async () => {
    await roundTrip(
      [{ rotate: 0, leaveCtm: true }, { rotate: 90, crop: [10, 20, 500, 700], leaveCtm: true }],
      [
        [{ cx: 200, cy: 300, width: 150, height: 50, rotation: 15 }],
        [{ cx: 300, cy: 250, width: 150, height: 50, rotation: 300 }],
      ],
    );
  });

  it("keeps a signature that hangs over the page edge (the viewer clips it to the CropBox)", async () => {
    await roundTrip(
      [{ rotate: 270, crop: [30, 40, 500, 700] }],
      [[{ cx: -20, cy: 15, width: 200, height: 70, rotation: 10 }]],
    );
  });

  it("embeds a PNG used 5 times exactly once, with its alpha channel", async () => {
    const boxes: Box[] = [0, 1, 2, 3, 4].map((i) => ({
      cx: 100 + i * 60,
      cy: 100 + i * 120,
      width: 160,
      height: 53,
      rotation: i * 20,
    }));
    const { saved } = await roundTrip([{ rotate: 0 }, { rotate: 90 }], [boxes.slice(0, 3), boxes.slice(3)]);

    const { images, masks } = await imageXObjects(saved);
    expect(images).toHaveLength(1);
    expect(images[0].dict.get(PDFName.of("Width"))?.toString()).toBe("300");
    // The PNG's transparency survives as a soft mask (CAP-2).
    expect(masks).toBe(1);
  });

  it("draws only on its own page when pages share one indirect /Contents array", async () => {
    const doc = await PDFDocument.create();
    const first = doc.addPage([595, 842]);
    first.drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0.2, 0.4, 0.8) });
    const second = doc.addPage([595, 842]);
    const contents = first.node.normalizedEntries().Contents!;
    const shared = doc.context.register(contents.clone());
    first.node.set(PDFName.of("Contents"), shared);
    second.node.set(PDFName.of("Contents"), shared);
    const source = await doc.save({ useObjectStreams: false });
    const sourceDoc = await openWithPdfjs(source);
    const vp = (await viewports(sourceDoc, 1)).get(0)!;

    const saved = await buildSignedPdf(
      source,
      [placed(vp, 0, { cx: 200, cy: 200, width: 100, height: 40, rotation: 0 })],
      IMAGES,
      new Map([[0, vp]]),
    );

    const savedDoc = await openWithPdfjs(saved);
    expect(await drawnImages(savedDoc, 0)).toHaveLength(1);
    expect(await drawnImages(savedDoc, 1)).toHaveLength(0);
    // The second page's content is exactly the shared original: no image operators
    // (pdf.js would silently skip them, since that page has no such resource).
    const streamCount = async (bytes: Uint8Array, pageIndex: number) => {
      const loaded = await PDFDocument.load(bytes);
      const node = loaded.getPage(pageIndex).node;
      return (node.lookup(PDFName.of("Contents"), PDFArray) as PDFArray).size();
    };
    expect(await streamCount(saved, 1)).toBe(await streamCount(source, 1));
    expect(await streamCount(saved, 0)).toBeGreaterThan(await streamCount(source, 0));
  });

  it("embeds each distinct image once", async () => {
    const source = await makeSource([{ rotate: 0 }]);
    const sourceDoc = await openWithPdfjs(source);
    const vp = (await viewports(sourceDoc, 1)).get(0)!;
    const box: Box = { cx: 200, cy: 200, width: 100, height: 100, rotation: 0 };
    const elements = [placed(vp, 0, box), placed(vp, 0, box, "img-2"), placed(vp, 0, box)];
    const saved = await buildSignedPdf(source, elements, IMAGES, new Map([[0, vp]]));
    expect((await imageXObjects(saved)).images).toHaveLength(2);
  });

  it("leaves pages, content and the document info untouched without elements", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Vertrag");
    doc.setProducer("Quelle 1.0");
    doc.setModificationDate(new Date("2020-01-02T03:04:05Z"));
    doc.addPage([595, 842]).drawText("Hallo", { x: 50, y: 700 });
    doc.addPage([300, 400]);
    const source = await doc.save({ useObjectStreams: false });

    const saved = await buildSignedPdf(source, [], IMAGES, new Map());

    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(2);
    expect(reloaded.getTitle()).toBe("Vertrag");
    expect(reloaded.getProducer()).toBe("Quelle 1.0");
    expect(reloaded.getModificationDate()?.toISOString()).toBe("2020-01-02T03:04:05.000Z");
    expect(reloaded.getPage(1).getSize()).toEqual({ width: 300, height: 400 });
    const savedDoc = await openWithPdfjs(saved);
    const text = await (await savedDoc.getPage(1)).getTextContent();
    expect(text.items.map((item) => ("str" in item ? item.str : "")).join("")).toBe("Hallo");
  });

  it("keeps existing annotations", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const annot = doc.context.register(
      doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30], Contents: "Notiz" }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
    const source = await doc.save({ useObjectStreams: false });
    const sourceDoc = await openWithPdfjs(source);
    const vp = (await viewports(sourceDoc, 1)).get(0)!;

    const saved = await buildSignedPdf(
      source,
      [placed(vp, 0, { cx: 100, cy: 100, width: 50, height: 20, rotation: 0 })],
      IMAGES,
      new Map([[0, vp]]),
    );

    const annots = await (await (await openWithPdfjs(saved)).getPage(1)).getAnnotations();
    expect(annots).toHaveLength(1);
    expect(annots[0].subtype).toBe("Text");
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPage(0).node.Annots()?.size()).toBe(1);
  });

  it("rejects unknown images and pages without a viewport, and never touches the source", async () => {
    const source = await makeSource([{ rotate: 0 }]);
    const before = source.slice();
    const sourceDoc = await openWithPdfjs(source);
    const vp = (await viewports(sourceDoc, 1)).get(0)!;
    const box: Box = { cx: 100, cy: 100, width: 50, height: 20, rotation: 0 };

    await expect(
      buildSignedPdf(source, [placed(vp, 0, box, "img-404")], IMAGES, new Map([[0, vp]])),
    ).rejects.toThrow(/unknown image/);
    await expect(buildSignedPdf(source, [placed(vp, 0, box)], IMAGES, new Map())).rejects.toThrow(
      /viewport/,
    );
    expect(source).toEqual(before);
  });
});

// Place/date texts: the drawn text box is read back from pdf.js' text content
// (string, baseline origin and em vectors) and compared with the preview box.

interface TextSpec {
  cx: number;
  cy: number;
  rotation: number;
  place: string;
  date: string;
  fontSize?: number;
}

/** A text placed where the preview (at `viewport`) shows it, centered at (cx, cy). */
function placedText(viewport: PageViewport, pageIndex: number, spec: TextSpec): PlaceDateElement {
  const fontSize = spec.fontSize ?? 11;
  const size = textBoxSize(bundledFont().metrics, formatPlaceDate(spec.place, spec.date), fontSize);
  const px = pdfUnitInPx(viewport);
  const box: Box = {
    cx: spec.cx,
    cy: spec.cy,
    width: size.width * px,
    height: size.height * px,
    rotation: spec.rotation,
  };
  return {
    id: `el-${nextId++}`,
    kind: "placeDate",
    pageIndex,
    place: spec.place,
    date: spec.date,
    fontSize,
    ...boxToGeometry(viewport, box),
  };
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
}

async function textItems(doc: PDFDocumentProxy, pageIndex: number): Promise<TextItemLike[]> {
  const content = await (await doc.getPage(pageIndex + 1)).getTextContent();
  return content.items.flatMap((item) => ("str" in item && item.str !== "" ? [item] : []));
}

/**
 * Screen corners (nw, ne, se, sw) of a drawn text: from the baseline origin
 * along the em vectors, ascender up and descender down, as wide as the
 * font's advances.
 */
function textScreenCorners(viewport: PageViewport, item: TextItemLike, text: string): Point[] {
  const { metrics } = bundledFont();
  const [a, b, c, d, e, f] = item.transform;
  const at = (u: number, v: number) =>
    toViewportPoint(viewport, { x: e + a * u + c * v, y: f + b * u + d * v });
  const w = metrics.advance(text);
  return [at(0, metrics.ascent), at(w, metrics.ascent), at(w, metrics.descent), at(0, metrics.descent)];
}

async function textRoundTrip(pages: PageSpec[], textsPerPage: TextSpec[][]) {
  const source = await makeSource(pages);
  const before = source.slice();
  const sourceDoc = await openWithPdfjs(source);
  const preview = await viewports(sourceDoc, PREVIEW_SCALE);
  const elements = textsPerPage.flatMap((specs, pageIndex) =>
    specs.map((spec) => placedText(preview.get(pageIndex)!, pageIndex, spec)),
  );

  const saved = await buildSignedPdf(source, elements, IMAGES, await viewports(sourceDoc, 1), FONT_BYTES);

  expect(source).toEqual(before);
  const savedDoc = await openWithPdfjs(saved);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const onPage = elements.filter((e) => e.pageIndex === pageIndex);
    const items = await textItems(savedDoc, pageIndex);
    const savedViewport = (await savedDoc.getPage(pageIndex + 1)).getViewport({ scale: PREVIEW_SCALE });
    for (const element of onPage) {
      const text = formatPlaceDate(element.place, element.date);
      const matching = items.filter((item) => item.str === text);
      expect(matching, text).toHaveLength(1);
      const [item] = matching;
      // The em vectors carry the font size: 1 pt of text space is 1 PDF unit here.
      expect(Math.hypot(item.transform[2], item.transform[3])).toBeCloseTo(element.fontSize, 6);
      expect(item.width).toBeCloseTo(bundledFont().metrics.advance(text) * element.fontSize, 3);
      const expected = boxCorners(boxFromGeometry(preview.get(pageIndex)!, element));
      expectCornersClose(textScreenCorners(savedViewport, item, text), expected);
    }
  }
  return { saved, elements };
}

/** Font descriptors in a saved PDF (one per embedded font). */
async function fontDescriptors(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, obj]) => obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"))
    .length;
}

describe("buildSignedPdf with place/date texts", () => {
  it("draws texts on a /Rotate 90 page and rotated by 30° at the preview's corners", async () => {
    await textRoundTrip(
      [{ rotate: 90, crop: [37, 61, 480, 700] }],
      [[
        { cx: 300, cy: 200, rotation: 0, place: "München", date: "17.10.2026" },
        { cx: 500, cy: 450, rotation: 30, place: "Łódź", date: "01.11.2026", fontSize: 17.5 },
      ]],
    );
  });

  it("matches the preview on /Rotate 0, 180 and 270 pages and after a CTM the page leaves behind", async () => {
    const texts: TextSpec[] = [
      { cx: 200, cy: 150, rotation: 0, place: "Ærøskøbing", date: "" },
      { cx: 380, cy: 600, rotation: 247.5, place: "", date: "17.10.2026", fontSize: 6 },
      { cx: 250, cy: 380, rotation: 30, place: "Zürich", date: "31.12.2026", fontSize: 24 },
    ];
    await textRoundTrip(
      [
        { rotate: 0, leaveCtm: true },
        { rotate: 180, crop: [11, 13, 560, 800] },
        { rotate: 270, crop: [45, 25, 520, 790], leaveCtm: true },
      ],
      [texts, texts, texts],
    );
  });

  it("extracts exactly the shown string, with no ligatures", async () => {
    // "ffi" would become one ligature glyph with Noto Sans' default shaping.
    const { saved } = await textRoundTrip(
      [{ rotate: 0 }],
      [[{ cx: 300, cy: 300, rotation: 0, place: "Waffingen", date: "02.03.2026" }]],
    );
    const page = await (await openWithPdfjs(saved)).getPage(1);
    const { fnArray, argsArray } = await page.getOperatorList();
    const shown = fnArray.flatMap((fn, i) =>
      fn === OPS.showText ? [(argsArray[i] as [unknown[]])[0].length] : [],
    );
    expect(shown).toEqual(["Waffingen, 02.03.2026".length]);
  });

  it("embeds the font once for texts on several pages, next to signatures", async () => {
    const source = await makeSource([{ rotate: 0 }, { rotate: 90 }]);
    const sourceDoc = await openWithPdfjs(source);
    const vps = await viewports(sourceDoc, 1);
    const elements = [
      placed(vps.get(0)!, 0, { cx: 200, cy: 200, width: 150, height: 50, rotation: 0 }),
      placedText(vps.get(0)!, 0, { cx: 200, cy: 300, rotation: 0, place: "München", date: "17.10.2026" }),
      placedText(vps.get(1)!, 1, { cx: 300, cy: 200, rotation: 10, place: "Berlin", date: "" }),
    ];
    const saved = await buildSignedPdf(source, elements, IMAGES, vps, FONT_BYTES);
    expect(await fontDescriptors(saved)).toBe(1);
    // A subset, not the whole 400 KB font file.
    expect(saved.byteLength).toBeLessThan(source.byteLength + 100_000);
    const savedDoc = await openWithPdfjs(saved);
    expect((await textItems(savedDoc, 0)).map((i) => i.str)).toEqual(["München, 17.10.2026"]);
    expect((await textItems(savedDoc, 1)).map((i) => i.str)).toEqual(["Berlin"]);
    expect(await drawnImages(savedDoc, 0)).toHaveLength(1);
  });

  it("refuses texts without the font", async () => {
    const source = await makeSource([{ rotate: 0 }]);
    const sourceDoc = await openWithPdfjs(source);
    const vp = (await viewports(sourceDoc, 1)).get(0)!;
    const text = placedText(vp, 0, { cx: 100, cy: 100, rotation: 0, place: "A", date: "" });
    await expect(buildSignedPdf(source, [text], IMAGES, new Map([[0, vp]]))).rejects.toThrow(/font/);
  });
});
