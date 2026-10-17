// Structural PNG check for signature files. Pure: no DOM, no decoding of the
// pixel data. It rejects anything that is not a well-formed PNG (wrong magic
// bytes, bad IHDR, broken chunk lengths or CRCs, missing IDAT/IEND) and reports
// the pixel size from IHDR.

export interface PngInfo {
  /** Pixel width from IHDR. */
  width: number;
  /** Pixel height from IHDR. */
  height: number;
}

export class PngError extends Error {
  constructor(reason: string) {
    super(`Not a valid PNG: ${reason}`);
    this.name = "PngError";
  }
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** PNG limits width and height to 2^31 - 1. */
const MAX_DIMENSION = 0x7fffffff;
/** Allowed bit depths per color type (PNG spec, table 11.1). */
const BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16], // greyscale
  2: [8, 16], // truecolour
  3: [1, 2, 4, 8], // indexed
  4: [8, 16], // greyscale + alpha
  6: [8, 16], // truecolour + alpha
};

let crcTable: Uint32Array | undefined;

function crc32(data: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
}

/**
 * Validates `bytes` as a PNG and returns its pixel size. Throws `PngError` for
 * anything else, including empty or truncated files.
 */
export function readPngInfo(bytes: Uint8Array): PngInfo {
  if (bytes.byteLength < SIGNATURE.length || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new PngError("missing PNG signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = SIGNATURE.length;
  let info: PngInfo | null = null;
  let sawIdat = false;
  let sawIend = false;
  let index = 0;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new PngError("truncated chunk header");
    const length = view.getUint32(offset);
    const type = chunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > bytes.byteLength) {
      throw new PngError(`chunk ${type} exceeds the file`);
    }
    if (!/^[A-Za-z]{4}$/.test(type)) throw new PngError("invalid chunk type");
    if (crc32(bytes, offset + 4, dataEnd) !== view.getUint32(dataEnd)) {
      throw new PngError(`CRC mismatch in ${type}`);
    }

    if (index === 0) {
      if (type !== "IHDR" || length !== 13) throw new PngError("IHDR must come first");
      info = readIhdr(view, dataStart);
    } else if (type === "IHDR") {
      throw new PngError("duplicate IHDR");
    } else if (type === "IDAT") {
      sawIdat = true;
    } else if (type === "IEND") {
      sawIend = true;
      break; // anything after IEND is ignored, as decoders do
    }
    offset = dataEnd + 4;
    index++;
  }

  if (!info) throw new PngError("missing IHDR");
  if (!sawIdat) throw new PngError("missing image data");
  if (!sawIend) throw new PngError("missing IEND");
  return info;
}

function readIhdr(view: DataView, start: number): PngInfo {
  const width = view.getUint32(start);
  const height = view.getUint32(start + 4);
  const bitDepth = view.getUint8(start + 8);
  const colorType = view.getUint8(start + 9);
  const compression = view.getUint8(start + 10);
  const filter = view.getUint8(start + 11);
  const interlace = view.getUint8(start + 12);
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new PngError("invalid image size");
  }
  if (!BIT_DEPTHS[colorType]?.includes(bitDepth)) {
    throw new PngError("invalid bit depth / color type");
  }
  if (compression !== 0 || filter !== 0 || interlace > 1) {
    throw new PngError("unsupported compression, filter or interlace method");
  }
  return { width, height };
}
