// The single pdf.js boundary for loading documents. Everything else in the app
// works with the `LoadedPdf` handle returned from here.

import { PDFDocument } from "pdf-lib";
import { getDocument, PasswordException, type PDFDocumentProxy } from "./pdfjs";

export type PdfjsLoadOptions = Omit<
  NonNullable<Parameters<typeof getDocument>[0]>,
  "data" | "url" | "range" | "password"
>;

/**
 * Why a file was refused. Each kind maps to a German message in the UI.
 * "uneditable": pdf.js can show the file, but pdf-lib (which writes the signed
 * copy) cannot load it, so it could never be saved.
 */
export type PdfLoadErrorKind = "encrypted" | "invalid" | "uneditable";

const LOAD_ERROR_TEXT: Record<PdfLoadErrorKind, string> = {
  encrypted: "PDF is encrypted or password-protected",
  invalid: "File is not a readable PDF",
  uneditable: "PDF cannot be loaded for writing",
};

export class PdfLoadError extends Error {
  readonly kind: PdfLoadErrorKind;

  constructor(kind: PdfLoadErrorKind, options?: { cause?: unknown }) {
    super(LOAD_ERROR_TEXT[kind], options);
    this.name = "PdfLoadError";
    this.kind = kind;
  }
}

/**
 * Maps an error from loading a PDF to the reason shown to the user: a
 * password request from pdf.js means "encrypted", anything else (pdf.js'
 * `InvalidPDFException`, empty or truncated files, ...) means the bytes could
 * not be used as a PDF.
 */
export function classifyLoadError(error: unknown): PdfLoadErrorKind {
  if (error instanceof PdfLoadError) return error.kind;
  if (error instanceof PasswordException) return "encrypted";
  // Match by name as well in case the error comes from another copy of pdf.js.
  if ((error as { name?: unknown } | null)?.name === "PasswordException") return "encrypted";
  return "invalid";
}

/** A document that passed all checks and can be rendered. */
export interface LoadedPdf {
  readonly proxy: PDFDocumentProxy;
  readonly pageCount: number;
  /** Releases the pdf.js worker resources of this document. */
  destroy(): Promise<void>;
}

/**
 * Applied to every load: no eval of PDF-derived code, no XFA. pdfjs-dist 6
 * dropped `isEvalSupported` because it no longer uses eval at all (PostScript
 * functions are interpreted or compiled to WebAssembly); the flag is still
 * passed so the intent survives a library change, and the CSP forbids
 * 'unsafe-eval' either way. PDF JavaScript stays off (`enableScripting` is a
 * viewer-layer option this app never enables).
 */
const SECURITY_OPTIONS = { isEvalSupported: false, enableXfa: false } as const;

/** Asset URLs etc.; set once at startup by `configurePdfLoading`. */
let loadOptions: PdfjsLoadOptions = {};

export function configurePdfLoading(options: PdfjsLoadOptions): void {
  loadOptions = { ...options };
}

/** What pdf-lib, which writes the signed copy, makes of the file. */
type PdfLibCheck =
  | { status: "ok"; pageCount: number }
  | { status: "encrypted" }
  | { status: "unloadable"; error: unknown };

/**
 * Loads the file with pdf-lib the way saving will. pdf-lib cannot save
 * encrypted PDFs, so even an owner-password-only file that pdf.js opens
 * without a password must be refused, and a file pdf-lib cannot parse at all
 * could be shown but never saved.
 *
 * `PDFDocument.load` without `ignoreEncryption` throws `EncryptedPDFError` for
 * encrypted files, but pdf-lib's errors are ES5 subclasses of `Error`, so
 * `instanceof EncryptedPDFError` never matches. Loading with
 * `ignoreEncryption` and reading `isEncrypted` asks the same question reliably.
 */
async function checkWithPdfLib(bytes: Uint8Array): Promise<PdfLibCheck> {
  try {
    const doc = await PDFDocument.load(bytes.slice(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (doc.isEncrypted) return { status: "encrypted" };
    return { status: "ok", pageCount: doc.getPageCount() };
  } catch (error) {
    return { status: "unloadable", error };
  }
}

/** pdf.js reports the security handler of an encrypted file in its document info. */
async function isEncryptedForPdfjs(proxy: PDFDocumentProxy): Promise<boolean> {
  const { info } = await proxy.getMetadata();
  return Boolean((info as { EncryptFilterName?: unknown } | null)?.EncryptFilterName);
}

/**
 * Loads a PDF from bytes. Rejects with `PdfLoadError` if the file is encrypted
 * (with or without a user password), cannot be parsed, or can be shown by
 * pdf.js but not loaded by pdf-lib (or pdf-lib sees a different page count, so
 * signatures would land on the wrong pages). `bytes` is not modified or
 * detached; pdf.js and pdf-lib get their own copies.
 */
export async function loadPdfDocument(bytes: Uint8Array): Promise<LoadedPdf> {
  const task = getDocument({
    ...loadOptions,
    ...SECURITY_OPTIONS,
    // pdf.js transfers (detaches) the buffer it is given.
    data: bytes.slice(),
  });

  const pdfLib = checkWithPdfLib(bytes);

  let proxy: PDFDocumentProxy;
  try {
    proxy = await task.promise;
    if (proxy.numPages < 1) throw new PdfLoadError("invalid");
    const pdfLibResult = await pdfLib;
    if (pdfLibResult.status === "encrypted" || (await isEncryptedForPdfjs(proxy))) {
      throw new PdfLoadError("encrypted");
    }
    if (pdfLibResult.status === "unloadable") {
      throw new PdfLoadError("uneditable", { cause: pdfLibResult.error });
    }
    if (pdfLibResult.pageCount !== proxy.numPages) throw new PdfLoadError("uneditable");
  } catch (error) {
    await task.destroy().catch(() => undefined);
    // A file pdf.js cannot parse may still be flagged as encrypted by pdf-lib.
    const kind = (await pdfLib).status === "encrypted" ? "encrypted" : classifyLoadError(error);
    throw error instanceof PdfLoadError && error.kind === kind
      ? error
      : new PdfLoadError(kind, { cause: error });
  }

  return {
    proxy,
    pageCount: proxy.numPages,
    destroy: () => task.destroy(),
  };
}
