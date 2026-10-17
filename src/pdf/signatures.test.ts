import { PDFDocument, PDFName, PDFNull, PDFRef, PDFString, type PDFObject } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { makeMalformedFormPdf, makeSignedPdf } from "./signatureFixtures.test-data";
import { countSignedSignatureFields } from "./signatures";

async function count(bytes: Uint8Array): Promise<{ count: number; problems: unknown[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const problems: unknown[] = [];
  return { count: countSignedSignatureFields(doc, (p) => problems.push(p)), problems };
}

/** A blank document whose /AcroForm /Fields is set from `build`. */
async function withFields(build: (doc: PDFDocument) => PDFObject): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({ Fields: build(doc) }));
  return doc;
}

describe("countSignedSignatureFields", () => {
  it("is 0 without an AcroForm or without fields", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(countSignedSignatureFields(doc)).toBe(0);
    doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({}));
    expect(countSignedSignatureFields(doc)).toBe(0);
  });

  it("counts one signed /Sig field", async () => {
    expect(await count(await makeSignedPdf([{}]))).toEqual({ count: 1, problems: [] });
  });

  it("counts several signed fields", async () => {
    expect((await count(await makeSignedPdf([{}, {}]))).count).toBe(2);
  });

  it("does not count an empty signature field (no /V)", async () => {
    expect(await count(await makeSignedPdf([{ signed: false }]))).toEqual({ count: 0, problems: [] });
    expect((await count(await makeSignedPdf([{ signed: false }, {}]))).count).toBe(1);
  });

  it("detects a signed widget in a parent's /Kids that inherits /FT /Sig", async () => {
    expect(await count(await makeSignedPdf([{ layout: "nested" }]))).toEqual({ count: 1, problems: [] });
    expect((await count(await makeSignedPdf([{ layout: "nested", signed: false }]))).count).toBe(0);
  });

  it("does not count other field types with a value, nor a /V of null", async () => {
    const doc = await withFields(({ context }) =>
      context.obj([
        context.register(context.obj({ FT: "Tx", T: PDFString.of("Name"), V: PDFString.of("Max") })),
        context.register(context.obj({ FT: "Sig", T: PDFString.of("Leer"), V: PDFNull })),
      ]),
    );
    expect(countSignedSignatureFields(doc)).toBe(0);
  });

  it("a child's own /FT overrides the inherited one", async () => {
    const doc = await withFields(({ context }) => {
      const kid = context.register(context.obj({ FT: "Tx", V: PDFString.of("x") }));
      return context.obj([context.register(context.obj({ FT: "Sig", Kids: [kid] }))]);
    });
    expect(countSignedSignatureFields(doc)).toBe(0);
  });

  it("follows a referenced /AcroForm and /Fields array", async () => {
    const doc = await PDFDocument.load(await makeSignedPdf([{}]));
    const { context, catalog } = doc;
    const acroForm = context.lookup(catalog.get(PDFName.of("AcroForm")))!;
    catalog.set(PDFName.of("AcroForm"), context.register(acroForm));
    expect(countSignedSignatureFields(doc)).toBe(1);
  });

  describe("malformed AcroForm: 0, no throw, problem reported", () => {
    for (const kind of ["fieldsNotArray", "cycle", "brokenRef"] as const) {
      it(kind, async () => {
        const result = await count(await makeMalformedFormPdf(kind));
        expect(result.count).toBe(0);
        expect(result.problems.length).toBeGreaterThan(0);
      });
    }

    it("an /AcroForm that is not a dictionary", async () => {
      const doc = await PDFDocument.create();
      doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj(5));
      const onProblem = vi.fn();
      expect(countSignedSignatureFields(doc, onProblem)).toBe(0);
      expect(onProblem).toHaveBeenCalledTimes(1);
    });

    it("/Kids that is not an array", async () => {
      const doc = await withFields(({ context }) =>
        context.obj([context.register(context.obj({ FT: "Sig", Kids: 7 }))]),
      );
      const onProblem = vi.fn();
      expect(countSignedSignatureFields(doc, onProblem)).toBe(0);
      expect(onProblem).toHaveBeenCalledWith("/Kids is not an array");
    });

    it("an unexpected error yields 0 and is reported", () => {
      const error = new Error("kaputt");
      const doc = {
        context: {},
        catalog: { get: () => { throw error; } },
      } as unknown as PDFDocument;
      const onProblem = vi.fn();
      expect(countSignedSignatureFields(doc, onProblem)).toBe(0);
      expect(onProblem).toHaveBeenCalledWith(error);
    });
  });

  it("counts a signed field inside a reference cycle once and terminates", async () => {
    const doc = await withFields(({ context }) => {
      const parent = context.nextRef();
      const kid = context.register(context.obj({ V: context.obj({ Type: "Sig" }), Kids: [parent] }));
      context.assign(parent, context.obj({ FT: "Sig", Kids: [kid] }));
      return context.obj([parent]);
    });
    const onProblem = vi.fn();
    expect(countSignedSignatureFields(doc, onProblem)).toBe(1);
    expect(onProblem).toHaveBeenCalledWith(
      "form field reached twice (duplicate entry or reference cycle)",
    );
  });

  it("walks a very deep /Kids chain without overflowing the stack", async () => {
    const doc = await withFields(({ context }) => {
      let child: PDFRef = context.register(context.obj({ V: context.obj({ Type: "Sig" }) }));
      for (let i = 0; i < 100_000; i++) child = context.register(context.obj({ Kids: [child] }));
      return context.obj([context.register(context.obj({ FT: "Sig", Kids: [child] }))]);
    });
    expect(countSignedSignatureFields(doc)).toBe(1);
  });
});
