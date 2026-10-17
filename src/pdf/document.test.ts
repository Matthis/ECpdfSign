import { PDFDocument } from "pdf-lib";
import { InvalidPDFException, PasswordException } from "./pdfjs";
import { describe, expect, it } from "vitest";
import { classifyLoadError, loadPdfDocument, PdfLoadError } from "./document";
import { OWNER_PASSWORD_ONLY_PDF, USER_PASSWORD_PDF } from "./encryptedFixtures.test-data";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  return doc.save();
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

  it("rejects a truncated PDF", async () => {
    const bytes = await makePdf(3);
    await expectRejected(bytes.subarray(0, 40), "invalid");
  });
});
