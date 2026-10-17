// The single pdf.js boundary for loading documents. Everything else in the app
// works with the `LoadedPdf` handle returned from here.

import { PDFDocument } from "pdf-lib";
import { getDocument, PasswordException, type PDFDocumentProxy } from "./pdfjs";

export type PdfjsLoadOptions = Omit<
  NonNullable<Parameters<typeof getDocument>[0]>,
  "data" | "url" | "range" | "password"
>;

/** Why a file was refused. Both kinds map to a German message in the UI. */
export type PdfLoadErrorKind = "encrypted" | "invalid";

export class PdfLoadError extends Error {
  readonly kind: PdfLoadErrorKind;

  constructor(kind: PdfLoadErrorKind, options?: { cause?: unknown }) {
    super(
      kind === "encrypted"
        ? "PDF is encrypted or password-protected"
        : "File is not a readable PDF",
      options,
    );
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

/**
 * Whether pdf-lib (which later writes the signed copy) sees the file as
 * encrypted. pdf-lib cannot save encrypted PDFs, so even an owner-password-only
 * file that pdf.js opens without a password must be refused.
 *
 * `PDFDocument.load` without `ignoreEncryption` throws `EncryptedPDFError` in
 * exactly this case, but pdf-lib's errors are ES5 subclasses of `Error`, so
 * `instanceof EncryptedPDFError` never matches. Loading with
 * `ignoreEncryption` and reading `isEncrypted` asks the same question reliably.
 */
async function isEncryptedForPdfLib(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return doc.isEncrypted;
  } catch {
    // Unparseable for pdf-lib: pdf.js decides whether the file is readable.
    return false;
  }
}

/** pdf.js reports the security handler of an encrypted file in its document info. */
async function isEncryptedForPdfjs(proxy: PDFDocumentProxy): Promise<boolean> {
  const { info } = await proxy.getMetadata();
  return Boolean((info as { EncryptFilterName?: unknown } | null)?.EncryptFilterName);
}

/**
 * Loads a PDF from bytes. Rejects with `PdfLoadError` if the file is encrypted
 * (with or without a user password) or cannot be parsed. `bytes` is not
 * modified or detached; pdf.js gets its own copy.
 */
export async function loadPdfDocument(bytes: Uint8Array): Promise<LoadedPdf> {
  const task = getDocument({
    ...loadOptions,
    ...SECURITY_OPTIONS,
    // pdf.js transfers (detaches) the buffer it is given.
    data: bytes.slice(),
  });

  const pdfLibEncrypted = isEncryptedForPdfLib(bytes);

  let proxy: PDFDocumentProxy;
  try {
    proxy = await task.promise;
    if (proxy.numPages < 1) throw new PdfLoadError("invalid");
    if ((await pdfLibEncrypted) || (await isEncryptedForPdfjs(proxy))) {
      throw new PdfLoadError("encrypted");
    }
  } catch (error) {
    await task.destroy().catch(() => undefined);
    // A file pdf.js cannot parse may still be flagged as encrypted by pdf-lib.
    const kind = (await pdfLibEncrypted) ? "encrypted" : classifyLoadError(error);
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
