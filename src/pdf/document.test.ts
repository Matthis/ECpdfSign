import { PDFDocument } from "pdf-lib";
import { InvalidPDFException, PasswordException } from "./pdfjs";
import { describe, expect, it } from "vitest";
import { classifyLoadError, loadPdfDocument, PdfLoadError } from "./document";
import { OWNER_PASSWORD_ONLY_PDF, USER_PASSWORD_PDF } from "./encryptedFixtures.test-data";

async function makePdf(pageCount: number, options?: { plain?: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  // `plain`: no object streams, so the structure can be patched as text.
  return doc.save({ useObjectStreams: !options?.plain });
}

/** Replaces the first `search` in a PDF's bytes (Latin-1, so byte offsets stay put). */
function patch(bytes: Uint8Array, search: string, replacement: string): Uint8Array {
  if (search.length !== replacement.length) throw new Error("patch must keep the length");
  const text = new TextDecoder("latin1").decode(bytes);
  const index = text.indexOf(search);
  if (index < 0) throw new Error(`${search} not found`);
  const out = bytes.slice();
  for (let i = 0; i < replacement.length; i++) out[index + i] = replacement.charCodeAt(i);
  return out;
}

async function expectRejected(bytes: Uint8Array, kind: PdfLoadError["kind"]): Promise<void> {
  const error = await loadPdfDocument(bytes).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PdfLoadError);
  expect((error as PdfLoadError).kind).toBe(kind);
}

describe("classifyLoadError", () => {
  it("treats a pdf.js password request as encrypted", () => {
    expect(classifyLoadError(new PasswordException("No password given", 1))).toBe("encrypted");
  });

  it("matches password errors from another pdf.js copy by name", () => {
    expect(classifyLoadError({ name: "PasswordException", message: "x" })).toBe("encrypted");
  });

  it("treats parse failures and unknown errors as invalid", () => {
    expect(classifyLoadError(new InvalidPDFException("Invalid PDF structure."))).toBe("invalid");
    expect(classifyLoadError(new Error("boom"))).toBe("invalid");
    expect(classifyLoadError("boom")).toBe("invalid");
    expect(classifyLoadError(null)).toBe("invalid");
  });

  it("keeps the kind of an already classified error", () => {
    expect(classifyLoadError(new PdfLoadError("encrypted"))).toBe("encrypted");
  });
});

describe("loadPdfDocument", () => {
  it("loads a normal PDF and reports its page count", async () => {
    const bytes = await makePdf(10);
    const before = bytes.slice();
    const pdf = await loadPdfDocument(bytes);
    try {
      expect(pdf.pageCount).toBe(10);
      // The caller's bytes stay intact (pdf.js detaches the buffer it gets).
      expect(bytes.byteLength).toBe(before.byteLength);
      expect(bytes).toEqual(before);
    } finally {
      await pdf.destroy();
    }
  });

  it("rejects a PDF that needs a password", async () => {
    await expectRejected(USER_PASSWORD_PDF(), "encrypted");
  });

  it("rejects an encrypted PDF that opens without a password", async () => {
    await expectRejected(OWNER_PASSWORD_ONLY_PDF(), "encrypted");
  });

  it("rejects bytes that are not a PDF", async () => {
    await expectRejected(
      new TextEncoder().encode("Das ist keine PDF-Datei.\n".repeat(20)),
      "invalid",
    );
  });

  it("rejects an empty file", async () => {
    await expectRejected(new Uint8Array(), "invalid");
  });

  it("rejects a PDF pdf.js can show but pdf-lib cannot load (no %PDF header) as uneditable", async () => {
    const bytes = patch(await makePdf(2, { plain: true }), "%PDF-", "%XYZ-");
    // pdf.js alone accepts the file, so this really is the pdf-lib check.
    const { getDocument } = await import("./pdfjs");
    const task = getDocument({ data: bytes.slice() });
    expect((await task.promise).numPages).toBe(2);
    await task.destroy();

    await expectRejected(bytes, "uneditable");
  });

  it("rejects a PDF whose page count pdf.js and pdf-lib disagree on as uneditable", async () => {
    // /Count says 1 (pdf.js shows 1 page), the page tree holds 2 (pdf-lib walks them all).
    await expectRejected(patch(await makePdf(2, { plain: true }), "/Count 2", "/Count 1"), "uneditable");
  });

  it("rejects a truncated PDF", async () => {
    const bytes = await makePdf(3);
    await expectRejected(bytes.subarray(0, 40), "invalid");
  });
});
