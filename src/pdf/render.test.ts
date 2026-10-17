import { degrees, PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDocument, type PDFPageProxy } from "./pdfjs";
import { fitViewport } from "./render";

// Portrait page, landscape page, and a portrait MediaBox rotated by 90° with a CropBox.
async function makeTestPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([842, 595]);
  const rotated = doc.addPage([600, 800]);
  rotated.setCropBox(50, 100, 400, 500);
  rotated.setRotation(degrees(90));
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

// Window sizes the page area goes through while the window is resized.
const BOUNDS: Array<[number, number]> = [
  [1032, 761],
  [800, 589],
  [400, 900],
  [1600, 1000],
  [120, 90],
];

describe("matrix: Window resize (page view) - fitViewport", () => {
  for (const [label, pageIndex] of [
    ["portrait", 0],
    ["landscape", 1],
    ["rotated 90° with CropBox", 2],
  ] as const) {
    it(`keeps a ${label} page inside the bounds with its aspect ratio`, () => {
      const page = pages[pageIndex];
      const natural = page.getViewport({ scale: 1 });
      for (const [width, height] of BOUNDS) {
        const vp = fitViewport(page, width, height);
        expect(vp.width).toBeLessThanOrEqual(width + 1e-6);
        expect(vp.height).toBeLessThanOrEqual(height + 1e-6);
        // Fills one dimension exactly (page is as large as possible).
        expect(Math.max(vp.width / width, vp.height / height)).toBeCloseTo(1, 6);
        // Same aspect ratio as the unscaled page, rotation included.
        expect(vp.width / vp.height).toBeCloseTo(natural.width / natural.height, 6);
        expect(vp.rotation).toBe(natural.rotation);
      }
    });
  }

  it("re-fits to a larger page when the window grows", () => {
    const small = fitViewport(pages[0], 600, 400);
    const large = fitViewport(pages[0], 1200, 800);
    expect(large.scale).toBeCloseTo(small.scale * 2, 6);
  });

  it("uses the rotated dimensions of a rotated page", () => {
    // CropBox 400 x 500 rotated by 90° is shown 500 wide and 400 high.
    const vp = fitViewport(pages[2], 1000, 1000);
    expect(vp.width).toBeCloseTo(1000);
    expect(vp.height).toBeCloseTo(800);
  });
});
