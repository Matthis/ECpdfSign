import { describe, expect, it, vi } from "vitest";
import {
  decodeOpenPayload,
  decodeSavePayload,
  decodeSignaturePayload,
  EMPTY_FILE_ERROR,
  pickSignaturePng,
  SAVE_INVALID_BODY_ERROR,
  SAVE_NO_DOCUMENT_ERROR,
  savePdf,
} from "./backend";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

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

describe("pickSignaturePng", () => {
  it("returns null for the cancel payload", async () => {
    invokeMock.mockResolvedValueOnce(new ArrayBuffer(0));
    await expect(pickSignaturePng()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenLastCalledWith("pick_signature_png");
  });

  it("returns the file bytes", async () => {
    invokeMock.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
    await expect(pickSignaturePng()).resolves.toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("turns an empty file into zero bytes, not a cancel", async () => {
    // The literal is the contract with lib.rs (EMPTY_FILE_ERROR there).
    invokeMock.mockRejectedValueOnce("empty-file");
    expect(EMPTY_FILE_ERROR).toBe("empty-file");
    const result = await pickSignaturePng();
    expect(result).not.toBeNull();
    expect(result?.byteLength).toBe(0);
  });

  it("passes other backend errors on", async () => {
    invokeMock.mockRejectedValueOnce("Access is denied. (os error 5)");
    await expect(pickSignaturePng()).rejects.toBe("Access is denied. (os error 5)");
  });

  it("decodes the raw payload", () => {
    expect(decodeSignaturePayload(new Uint8Array())).toBeNull();
    expect(decodeSignaturePayload(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]));
  });
});

describe("savePdf", () => {
  it("sends the PDF as the raw body, not as JSON", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 signiert");
    invokeMock.mockResolvedValueOnce(new TextEncoder().encode("Vertrag_signiert.pdf").buffer);
    await expect(savePdf(pdf)).resolves.toBe("Vertrag_signiert.pdf");
    expect(invokeMock).toHaveBeenLastCalledWith("save_pdf", pdf);
    expect(invokeMock.mock.lastCall?.[1]).toBeInstanceOf(Uint8Array);
  });

  it("returns null when the dialog was cancelled", async () => {
    invokeMock.mockResolvedValueOnce(new ArrayBuffer(0));
    await expect(savePdf(new Uint8Array([1]))).resolves.toBeNull();
  });

  it("decodes a UTF-8 file name", () => {
    expect(decodeSavePayload(new TextEncoder().encode("Übersicht_signiert.pdf"))).toBe(
      "Übersicht_signiert.pdf",
    );
    expect(decodeSavePayload(new Uint8Array())).toBeNull();
  });

  it("passes backend errors on; the literals are the contract with lib.rs", async () => {
    // SAVE_NO_DOCUMENT_ERROR / SAVE_INVALID_BODY_ERROR in src-tauri/src/lib.rs.
    expect(SAVE_NO_DOCUMENT_ERROR).toBe("no-document");
    expect(SAVE_INVALID_BODY_ERROR).toBe("invalid-body");
    invokeMock.mockRejectedValueOnce("no-document");
    await expect(savePdf(new Uint8Array([1]))).rejects.toBe(SAVE_NO_DOCUMENT_ERROR);
  });
});
