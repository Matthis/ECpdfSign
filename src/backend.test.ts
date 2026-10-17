import { describe, expect, it } from "vitest";
import { decodeOpenPayload } from "./backend";

// Mirrors encode_open_payload in src-tauri/src/lib.rs.
function encode(name: string, pdf: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const out = new Uint8Array(4 + nameBytes.length + pdf.length);
  new DataView(out.buffer).setUint32(0, nameBytes.length, true);
  out.set(nameBytes, 4);
  out.set(pdf, 4 + nameBytes.length);
  return out;
}

/** Golden vector shared with `GOLDEN_PAYLOAD` in src-tauri/src/lib.rs; change both together. */
const GOLDEN_PAYLOAD = new Uint8Array([
  6, 0, 0, 0, // name length (u32 LE)
  0xc3, 0x9c, 0x2e, 0x70, 0x64, 0x66, // "Ü.pdf" (UTF-8)
  0x25, 0x50, 0x44, 0x46, // "%PDF"
]);

describe("decodeOpenPayload", () => {
  it("decodes the golden vector produced by the Rust encoder", () => {
    expect(decodeOpenPayload(GOLDEN_PAYLOAD.buffer)).toEqual({
      name: "Ü.pdf",
      bytes: new TextEncoder().encode("%PDF"),
    });
  });

  it("returns null for the cancel payload", () => {
    expect(decodeOpenPayload(new ArrayBuffer(0))).toBeNull();
  });

  it("splits name and bytes", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    const result = decodeOpenPayload(encode("Vertrag Müller.pdf", pdf).buffer as ArrayBuffer);
    expect(result?.name).toBe("Vertrag Müller.pdf");
    expect(result?.bytes).toEqual(pdf);
  });

  it("accepts an empty file", () => {
    expect(decodeOpenPayload(encode("leer.pdf", new Uint8Array()))).toEqual({
      name: "leer.pdf",
      bytes: new Uint8Array(),
    });
  });

  it("rejects malformed payloads", () => {
    expect(() => decodeOpenPayload(new Uint8Array([1, 0]))).toThrow();
    expect(() => decodeOpenPayload(new Uint8Array([200, 0, 0, 0, 65]))).toThrow();
  });
});
