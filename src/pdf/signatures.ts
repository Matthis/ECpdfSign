// Detects digital signatures already in a PDF. Saving rewrites the whole file
// with pdf-lib, which invalidates them, so the app warns before saving.
//
// Walks the raw AcroForm objects instead of using `PDFDocument.getForm()`,
// which throws on or rewrites unusual forms. PDFs are untrusted input: every
// object is type-checked, references may be broken, and the field tree may
// contain cycles.

import { PDFArray, PDFDict, PDFName, PDFNull, type PDFDocument, type PDFObject } from "pdf-lib";

const ACRO_FORM = PDFName.of("AcroForm");
const FIELDS = PDFName.of("Fields");
const KIDS = PDFName.of("Kids");
const FT = PDFName.of("FT");
const V = PDFName.of("V");
const SIG = PDFName.of("Sig");

/** Receives each structural problem found while walking the form (for logging). */
export type SignatureScanProblem = (problem: unknown) => void;

/**
 * Counts the signed signature fields of `doc`: fields whose field type is
 * `/Sig` (their own `/FT` or one inherited from a parent field) and that have
 * a `/V` value. Fields in `/Kids` are walked at any depth.
 *
 * Never throws. Malformed parts (an `/AcroForm` or `/Fields` of the wrong
 * type, broken references, non-dictionary fields, reference cycles) are
 * skipped and reported to `onProblem`; an unexpected error is reported too
 * and the result is 0.
 */
export function countSignedSignatureFields(
  doc: PDFDocument,
  onProblem: SignatureScanProblem = () => undefined,
): number {
  try {
    const { context } = doc;
    const lookup = (object: PDFObject | undefined): PDFObject | undefined =>
      object === undefined ? undefined : context.lookup(object);

    const rawAcroForm = doc.catalog.get(ACRO_FORM);
    if (rawAcroForm === undefined) return 0;
    const acroForm = lookup(rawAcroForm);
    if (!(acroForm instanceof PDFDict)) {
      onProblem("/AcroForm is not a dictionary");
      return 0;
    }
    const rawFields = acroForm.get(FIELDS);
    if (rawFields === undefined) return 0;
    const fields = lookup(rawFields);
    if (!(fields instanceof PDFArray)) {
      onProblem("/AcroForm /Fields is not an array");
      return 0;
    }

    // Iterative depth-first walk, so a very deep tree cannot overflow the stack.
    const pending: Array<{ raw: PDFObject; inheritedType: PDFObject | undefined }> = [];
    const pushChildren = (array: PDFArray, inheritedType: PDFObject | undefined): void => {
      for (let i = array.size() - 1; i >= 0; i--) pending.push({ raw: array.get(i), inheritedType });
    };
    pushChildren(fields, undefined);

    const visited = new Set<PDFObject>();
    let count = 0;
    while (pending.length > 0) {
      const { raw, inheritedType } = pending.pop()!;
      const field = lookup(raw);
      if (!(field instanceof PDFDict)) {
        onProblem(`form field is ${field === undefined ? "a broken reference" : "not a dictionary"}`);
        continue;
      }
      if (visited.has(field)) {
        onProblem("form field reached twice (duplicate entry or reference cycle)");
        continue;
      }
      visited.add(field);

      const ownType = lookup(field.get(FT));
      const type = ownType ?? inheritedType;
      const value = lookup(field.get(V));
      if (type === SIG && value !== undefined && value !== PDFNull) count++;

      const rawKids = field.get(KIDS);
      if (rawKids === undefined) continue;
      const kids = lookup(rawKids);
      if (kids instanceof PDFArray) pushChildren(kids, type);
      else onProblem("/Kids is not an array");
    }
    return count;
  } catch (error) {
    onProblem(error);
    return 0;
  }
}
