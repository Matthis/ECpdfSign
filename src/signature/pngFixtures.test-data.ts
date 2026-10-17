// Builds real PNG files for tests (RGBA, 8 bit), so tests do not depend on binary fixtures.

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

export function ihdr(width: number, height: number, bitDepth = 8, colorType = 6): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = bitDepth;
  data[9] = colorType;
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
