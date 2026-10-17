// Every PNG variant is either embedded and saved with the right pixels and
// transparency, or refused at insert time.

import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import type { SignatureElement, StoredImage } from "../model";
import { getDocument, OPS } from "../pdf/pdfjs";
import { buildSignedPdf } from "../pdf/save";
import { checkPngEmbeddable } from "./pdfEmbed";
import { readPngInfo } from "./png";
import { encodePng, makeAnimatedPng, makePng, pngChunk, type SampleFn } from "./pngFixtures.test-data";

const W = 13;
const H = 9;

/** RGBA (8 bit) a viewer should show for each pixel. */
type Rgba = (x: number, y: number) => [number, number, number, number];

interface Fixture {
  name: string;
  png: Uint8Array;
  expected: Rgba;
}

// A pattern that varies per pixel, so row order and interlacing mistakes show.
const red = (x: number, y: number) => (x * 19 + y * 7) % 256;
const green = (x: number, y: number) => (x * 3 + y * 29) % 256;
const alpha = (x: number, y: number) => (x < W / 2 ? 255 : (x * 40 + y * 11) % 256);

const rgba16: SampleFn = (x, y) => [red(x, y) * 257, green(x, y) * 257 + 1, 0x8000, alpha(x, y) * 257];
const grey: SampleFn = (x, y) => [red(x, y), alpha(x, y)];
const rgba8: SampleFn = (x, y) => [red(x, y), green(x, y), 77, alpha(x, y)];

const PALETTE: Array<[number, number, number]> = [
  [255, 0, 0],
  [0, 128, 255],
  [20, 20, 20],
];
const PALETTE_ALPHA = [255, 128]; // index 2 has no tRNS entry: opaque
const index = (x: number, y: number) => (x + y) % 3;

const FIXTURES: Fixture[] = [
  {
    name: "16-bit RGBA",
    png: encodePng({ width: W, height: H, bitDepth: 16, colorType: 6, samples: rgba16 }),
    expected: (x, y) => [red(x, y), green(x, y), 0x80, alpha(x, y)],
  },
  {
    name: "indexed with tRNS",
    png: encodePng({
      width: W,
      height: H,
      bitDepth: 8,
      colorType: 3,
      samples: (x, y) => [index(x, y)],
      before: [
        pngChunk("PLTE", new Uint8Array(PALETTE.flat())),
        pngChunk("tRNS", new Uint8Array(PALETTE_ALPHA)),
      ],
    }),
    expected: (x, y) => [...PALETTE[index(x, y)], PALETTE_ALPHA[index(x, y)] ?? 255],
  },
  {
    name: "greyscale with alpha",
    png: encodePng({ width: W, height: H, bitDepth: 8, colorType: 4, samples: grey }),
    expected: (x, y) => [red(x, y), red(x, y), red(x, y), alpha(x, y)],
  },
  {
    name: "interlaced (Adam7) RGBA",
    // 16 x 16: pdf-lib's PNG decoder (UPNG) sizes its inflate buffer large enough here.
    png: encodePng({ width: 16, height: 16, bitDepth: 8, colorType: 6, samples: rgba8, interlace: true }),
    expected: (x, y) => [red(x, y), green(x, y), 77, alpha(x, y)],
  },
];

const tasks: Array<ReturnType<typeof getDocument>> = [];
afterEach(async () => {
  for (const task of tasks.splice(0)) await task.destroy().catch(() => undefined);
});

/** Saves `png` as a signature and returns the RGBA pixels pdf.js decodes from the saved file. */
async function savedPixels(png: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const source = await (async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    return doc.save();
  })();
  const sourceTask = getDocument({ data: source.slice() });
  tasks.push(sourceTask);
  const viewport = (await (await sourceTask.promise).getPage(1)).getViewport({ scale: 1 });
  const { width, height } = readPngInfo(png);
  const images = new Map<string, StoredImage>([["img-1", { id: "img-1", bytes: png, width, height }]]);
  const element: SignatureElement = {
    id: "el-1",
    kind: "signature",
    pageIndex: 0,
    imageId: "img-1",
    rect: { x: 20, y: 20, width: 100, height: 70 },
    rotation: 0,
  };

  const saved = await buildSignedPdf(source, [element], images, new Map([[0, viewport]]));

  const task = getDocument({ data: saved.slice() });
  tasks.push(task);
  const page = await (await task.promise).getPage(1);
  const { fnArray, argsArray } = await page.getOperatorList();
  const paint = fnArray.indexOf(OPS.paintImageXObject);
  expect(paint).toBeGreaterThanOrEqual(0);
  const objId = (argsArray[paint] as [string])[0];
  type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };
  const image = await new Promise<DecodedImage>((resolve) =>
    page.objs.get(objId, (data: unknown) => resolve(data as DecodedImage)),
  );
  expect(image.data).toBeDefined();
  // pdf.js hands the image over as RGBA once a soft mask is applied, as RGB otherwise.
  const channels = image.data.length / (image.width * image.height);
  if (channels === 4) return image;
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) {
    rgba.set(image.data.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width: image.width, height: image.height, data: rgba };
}

describe("checkPngEmbeddable", () => {
  it("accepts the default RGBA fixture without touching its bytes", async () => {
    const png = makePng(30, 10);
    const before = png.slice();
    await expect(checkPngEmbeddable(png)).resolves.toBeUndefined();
    expect(png).toEqual(before);
  });

  for (const { name, png, expected } of FIXTURES) {
    it(`embeds a ${name} PNG and saves its pixels and transparency`, async () => {
      const { width, height } = readPngInfo(png);
      await expect(checkPngEmbeddable(png)).resolves.toBeUndefined();

      const image = await savedPixels(png);

      expect(image.width).toBe(width);
      expect(image.height).toBe(height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          expect([...image.data.subarray(i, i + 4)], `pixel ${x},${y}`).toEqual(expected(x, y));
        }
      }
    });
  }

  it("rejects an interlaced PNG that pdf-lib's decoder cannot inflate (13 x 9)", async () => {
    // UPNG reserves one byte per row for Adam7 overhead; at this size the
    // interlaced data is larger, so pdf-lib throws. Refused at insert, never at save.
    const png = encodePng({ width: W, height: H, bitDepth: 8, colorType: 6, samples: rgba8, interlace: true });
    expect(readPngInfo(png)).toEqual({ width: W, height: H });
    await expect(checkPngEmbeddable(png)).rejects.toThrow();
  });

  it("rejects an animated PNG that the structural check (and a browser) accept", async () => {
    const apng = makeAnimatedPng(8, 8);
    expect(readPngInfo(apng)).toEqual({ width: 8, height: 8 });
    await expect(checkPngEmbeddable(apng)).rejects.toThrow();
  });
});
