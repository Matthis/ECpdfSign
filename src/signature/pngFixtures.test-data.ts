// Builds real PNG files for tests (any color type, bit depth and interlacing,
// plus an animated PNG), so tests do not depend on binary fixtures.

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** zlib stream with uncompressed ("stored") deflate blocks; valid for every inflater. */
function zlibStored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let offset = 0; offset < data.length || offset === 0; offset += 0xffff) {
    const block = data.subarray(offset, offset + 0xffff);
    const last = offset + 0xffff >= data.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = last;
    new DataView(header.buffer).setUint16(1, block.length, true);
    new DataView(header.buffer).setUint16(3, ~block.length & 0xffff, true);
    parts.push(header, block);
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  parts.push(adler);
  return concat(...parts);
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function ihdr(
  width: number,
  height: number,
  bitDepth = 8,
  colorType = 6,
  interlace = 0,
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = bitDepth;
  data[9] = colorType;
  data[12] = interlace;
  return pngChunk("IHDR", data);
}

/**
 * A `width` x `height` RGBA PNG. The left half is opaque black, the right half
 * fully transparent, so transparency is actually exercised.
 */
export function makePng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width / 2; x++) raw[row + 1 + x * 4 + 3] = 255;
  }
  return concat(
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk("IDAT", zlibStored(raw)),
    pngChunk("IEND", new Uint8Array()),
  );
}

/** Per-channel samples of one pixel, in the PNG's bit depth (palette index for indexed PNGs). */
export type SampleFn = (x: number, y: number) => number[];

/** Adam7 passes: start x, start y, step x, step y. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Filter-type-0 scanlines for the given pixel coordinates (row by row). */
function scanlines(xs: number[], ys: number[], bitDepth: number, samples: SampleFn): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (const y of ys) {
    const values = xs.flatMap((x) => samples(x, y));
    const bits = values.length * bitDepth;
    const row = new Uint8Array(1 + Math.ceil(bits / 8));
    values.forEach((value, i) => {
      if (bitDepth === 16) {
        row[1 + i * 2] = value >> 8;
        row[2 + i * 2] = value & 0xff;
      } else if (bitDepth === 8) {
        row[1 + i] = value;
      } else {
        const bit = i * bitDepth;
        row[1 + (bit >> 3)] |= value << (8 - bitDepth - (bit & 7));
      }
    });
    rows.push(row);
  }
  return rows;
}

const range = (start: number, end: number, step: number) => {
  const out: number[] = [];
  for (let i = start; i < end; i += step) out.push(i);
  return out;
};

/**
 * Encodes any PNG variant: `samples` gives each pixel's channel values;
 * `before` chunks (PLTE, tRNS, acTL, ...) go between IHDR and IDAT, `after`
 * chunks between IDAT and IEND.
 */
export function encodePng(options: {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  samples: SampleFn;
  interlace?: boolean;
  before?: Uint8Array[];
  after?: Uint8Array[];
}): Uint8Array {
  const { width, height, bitDepth, colorType, samples, interlace = false } = options;
  const rows = interlace
    ? ADAM7.flatMap(([x0, y0, dx, dy]) => {
        const xs = range(x0, width, dx);
        const ys = range(y0, height, dy);
        return xs.length && ys.length ? scanlines(xs, ys, bitDepth, samples) : [];
      })
    : scanlines(range(0, width, 1), range(0, height, 1), bitDepth, samples);
  return concat(
    PNG_SIGNATURE,
    ihdr(width, height, bitDepth, colorType, interlace ? 1 : 0),
    ...(options.before ?? []),
    pngChunk("IDAT", zlibStored(concat(...rows))),
    ...(options.after ?? []),
    pngChunk("IEND", new Uint8Array()),
  );
}

function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
}

/**
 * A two-frame animated PNG (APNG). Browsers show its first frame, so it passes
 * the webview decode, but pdf-lib refuses animated PNGs.
 */
export function makeAnimatedPng(width: number, height: number): Uint8Array {
  const pixel: SampleFn = () => [0, 0, 0, 255];
  const frameControl = (sequence: number) =>
    pngChunk(
      "fcTL",
      concat(u32(sequence, width, height, 0, 0), new Uint8Array([0, 1, 0, 10, 0, 0])),
    );
  const raw = concat(...scanlines(range(0, width, 1), range(0, height, 1), 8, pixel));
  return encodePng({
    width,
    height,
    bitDepth: 8,
    colorType: 6,
    samples: pixel,
    before: [pngChunk("acTL", u32(2, 0)), frameControl(0)],
    after: [frameControl(1), pngChunk("fdAT", concat(u32(2), zlibStored(raw)))],
  });
}
