// Test PDFs with signature fields, built with pdf-lib's low-level objects in
// the structure real signing tools write: a /Sig field (widget merged in)
// whose /V is a signature dictionary.

import { PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, type PDFObject } from "pdf-lib";

export interface SigFieldSpec {
  /** Whether the field has a /V signature value. Default true. */
  signed?: boolean;
  /**
   * "nested": a parent field with /FT /Sig holds the field in /Kids; the
   * field itself has no /FT and inherits it.
   */
  layout?: "flat" | "nested";
}

function addSigField(doc: PDFDocument, index: number, spec: SigFieldSpec): PDFRef {
  const ctx = doc.context;
  const page = doc.getPage(0);
  const value = ctx.register(
    ctx.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "adbe.pkcs7.detached",
      ByteRange: [0, 0, 0, 0],
      Contents: PDFHexString.of("00".repeat(64)),
      M: PDFString.of("D:20261017120000Z"),
    }),
  );
  const widget: Record<string, PDFObject | string | number | Array<number>> = {
    Type: "Annot",
    Subtype: "Widget",
    Rect: [0, 0, 0, 0],
    F: 132,
    P: page.ref,
  };
  if (spec.signed !== false) widget.V = value;

  if (spec.layout === "nested") {
    const parentRef = ctx.nextRef();
    const kidRef = ctx.register(ctx.obj({ ...widget, Parent: parentRef }));
    ctx.assign(parentRef, ctx.obj({ FT: "Sig", T: PDFString.of(`Signatur${index}`), Kids: [kidRef] }));
    page.node.addAnnot(kidRef);
    return parentRef;
  }
  const ref = ctx.register(ctx.obj({ ...widget, FT: "Sig", T: PDFString.of(`Signatur${index}`) }));
  page.node.addAnnot(ref);
  return ref;
}

/** A 2-page PDF with the given signature fields in /AcroForm /Fields. */
export async function makeSignedPdf(fields: SigFieldSpec[] = [{}]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const refs = fields.map((spec, i) => addSigField(doc, i + 1, spec));
  doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({ Fields: refs, SigFlags: 3 }));
  return doc.save();
}

/** A 1-page PDF whose /AcroForm is broken in the given way. */
export async function makeMalformedFormPdf(
  kind: "fieldsNotArray" | "cycle" | "brokenRef",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const ctx = doc.context;
  let fields: PDFObject;
  if (kind === "fieldsNotArray") {
    fields = ctx.obj("Kaputt");
  } else if (kind === "brokenRef") {
    fields = ctx.obj([PDFRef.of(9999)]);
  } else {
    // A field that is its own kid (and its kid's parent), unsigned.
    const ref = ctx.nextRef();
    ctx.assign(ref, ctx.obj({ FT: "Sig", T: PDFString.of("Schleife"), Kids: [ref] }));
    fields = ctx.obj([ref]);
  }
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: fields }));
  return doc.save();
}
