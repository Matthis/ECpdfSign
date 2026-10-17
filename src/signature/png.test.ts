import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PngError, readPngInfo } from "./png";
import {
  concat,
  ihdr,
  makePng,
  PNG_SIGNATURE,
  pngChunk,
} from "./pngFixtures.test-data";

const IEND = pngChunk("IEND", new Uint8Array());
const IDAT = pngChunk("IDAT", new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]));

describe("readPngInfo", () => {
  it("reads the pixel size of a real RGBA PNG", () => {
    expect(readPngInfo(makePng(40, 12))).toEqual({ width: 40, height: 12 });
  });

  it("uses a fixture that a real decoder (pdf-lib, as used for saving) accepts", async () => {
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(makePng(700, 30));
    expect(image.width).toBe(700);
    expect(image.height).toBe(30);
  });

  it("accepts a PNG inside a larger buffer (non-zero byteOffset)", () => {
    const png = makePng(3, 5);
    const host = new Uint8Array(png.length + 7);
    host.set(png, 7);
    expect(readPngInfo(host.subarray(7))).toEqual({ width: 3, height: 5 });
  });

  it("ignores data after IEND", () => {
    expect(readPngInfo(concat(makePng(2, 2), new Uint8Array([1, 2, 3])))).toEqual({
      width: 2,
      height: 2,
    });
  });

  const REJECTED: Array<[string, Uint8Array]> = [
    ["an empty file", new Uint8Array()],
    ["a JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])],
    ["text", new TextEncoder().encode("Das ist kein Bild, nur Text.")],
    ["only the signature", PNG_SIGNATURE],
    ["a missing IHDR", concat(PNG_SIGNATURE, IDAT, IEND)],
    ["zero width", concat(PNG_SIGNATURE, ihdr(0, 10), IDAT, IEND)],
    ["an invalid bit depth", concat(PNG_SIGNATURE, ihdr(10, 10, 3, 6), IDAT, IEND)],
    ["an invalid color type", concat(PNG_SIGNATURE, ihdr(10, 10, 8, 5), IDAT, IEND)],
    ["no image data", concat(PNG_SIGNATURE, ihdr(10, 10), IEND)],
    ["no IEND (truncated)", concat(PNG_SIGNATURE, ihdr(10, 10), IDAT)],
    ["a duplicate IHDR", concat(PNG_SIGNATURE, ihdr(10, 10), ihdr(10, 10), IDAT, IEND)],
  ];

  for (const [name, bytes] of REJECTED) {
    it(`rejects ${name}`, () => {
      expect(() => readPngInfo(bytes)).toThrow(PngError);
    });
  }

  it("rejects a file cut off in the middle of a chunk", () => {
    const png = makePng(20, 20);
    expect(() => readPngInfo(png.subarray(0, png.length - 20))).toThrow(PngError);
  });

  it("rejects a corrupted byte (CRC mismatch)", () => {
    const png = makePng(20, 20).slice();
    png[45] ^= 0xff; // inside the IDAT data
    expect(() => readPngInfo(png)).toThrow(/CRC/);
  });
});
