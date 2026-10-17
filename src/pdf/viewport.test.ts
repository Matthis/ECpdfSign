import { degrees, PDFDocument } from "pdf-lib";
import { getDocument, type PDFPageProxy } from "./pdfjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  toPdfPoint,
  toPdfRect,
  toViewportPoint,
  toViewportRect,
  type PageViewport,
} from "./viewport";

// Page 1: plain page. Page 2: rotated 90 degrees with a CropBox whose origin is
// not (0, 0). Page 3: rotated 270 degrees with the same CropBox.
async function makeTestPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  const rotated = doc.addPage([600, 800]);
  rotated.setCropBox(50, 100, 400, 500);
  rotated.setRotation(degrees(90));
  const rotated270 = doc.addPage([600, 800]);
  rotated270.setCropBox(50, 100, 400, 500);
  rotated270.setRotation(degrees(270));
  return doc.save();
}

let destroy: (() => Promise<void>) | undefined;
const pages: PDFPageProxy[] = [];

beforeAll(async () => {
  const task = getDocument({ data: await makeTestPdf() });
  destroy = () => task.destroy();
  const doc = await task.promise;
  for (let i = 1; i <= doc.numPages; i++) pages.push(await doc.getPage(i));
});

afterAll(async () => {
  await destroy?.();
});

function viewport(pageIndex: number, scale = 1.5): PageViewport {
  return pages[pageIndex].getViewport({ scale });
}

function expectPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

const PAGES = [
  ["unrotated", 0],
  ["rotated 90° with CropBox offset", 1],
  ["rotated 270° with CropBox offset", 2],
] as const;

describe("viewport coordinate conversion", () => {
  it("maps the corners of an unrotated page to its user space", () => {
    const vp = viewport(0);
    expect(vp.width).toBeCloseTo(900);
    expect(vp.height).toBeCloseTo(1200);
    expectPointClose(toPdfPoint(vp, { x: 0, y: 0 }), { x: 0, y: 800 });
    expectPointClose(toPdfPoint(vp, { x: 900, y: 1200 }), { x: 600, y: 0 });
  });

  it("accounts for 90° rotation and the CropBox origin", () => {
    const vp = viewport(1);
    // The 400x500 CropBox is shown rotated: 500 wide, 400 high (x1.5).
    expect(vp.width).toBeCloseTo(750);
    expect(vp.height).toBeCloseTo(600);
    // Rotating clockwise puts the CropBox's bottom-left corner at the top-left.
    expectPointClose(toPdfPoint(vp, { x: 0, y: 0 }), { x: 50, y: 100 });
    expectPointClose(toPdfPoint(vp, { x: 750, y: 600 }), { x: 450, y: 600 });
  });

  it("accounts for 270° rotation and the CropBox origin", () => {
    const vp = viewport(2);
    expect(vp.width).toBeCloseTo(750);
    expect(vp.height).toBeCloseTo(600);
    expectPointClose(toPdfPoint(vp, { x: 0, y: 0 }), { x: 450, y: 600 });
    expectPointClose(toPdfPoint(vp, { x: 750, y: 600 }), { x: 50, y: 100 });
  });

  for (const [name, pageIndex] of PAGES) {
    it(`round-trips points on a ${name} page`, () => {
      const vp = viewport(pageIndex);
      for (const point of [
        { x: 0, y: 0 },
        { x: 12.5, y: 300.25 },
        { x: vp.width, y: vp.height },
        { x: vp.width / 3, y: vp.height * 0.7 },
      ]) {
        expectPointClose(toViewportPoint(vp, toPdfPoint(vp, point)), point);
      }
    });

    it(`round-trips rectangles on a ${name} page`, () => {
      const vp = viewport(pageIndex, 1.25);
      const rect = { left: 40, top: 60, width: 200, height: 80 };
      const pdfRect = toPdfRect(vp, rect);
      expect(pdfRect.width).toBeGreaterThan(0);
      expect(pdfRect.height).toBeGreaterThan(0);
      const back = toViewportRect(vp, pdfRect);
      expect(back.left).toBeCloseTo(rect.left, 6);
      expect(back.top).toBeCloseTo(rect.top, 6);
      expect(back.width).toBeCloseTo(rect.width, 6);
      expect(back.height).toBeCloseTo(rect.height, 6);
    });
  }

  it("swaps width and height of a rectangle on a 90° page", () => {
    const vp = viewport(1, 1);
    // On a page rotated by 90°, screen x runs along PDF y and screen y along PDF x.
    const pdfRect = toPdfRect(vp, { left: 10, top: 20, width: 200, height: 50 });
    expect(pdfRect.width).toBeCloseTo(50);
    expect(pdfRect.height).toBeCloseTo(200);
    expect(pdfRect.x).toBeCloseTo(50 + 20);
    expect(pdfRect.y).toBeCloseTo(100 + 10);
  });
});
