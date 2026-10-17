// Typed wrappers around the Rust commands. The frontend never handles file
// paths: the backend shows the dialog, keeps the path and returns only bytes.

import { invoke } from "@tauri-apps/api/core";

export interface OpenedPdf {
  /** File name for display. */
  name: string;
  bytes: Uint8Array;
}

/**
 * Decodes the `open_pdf` payload: u32 LE name length, UTF-8 name, PDF bytes.
 * An empty payload means the dialog was cancelled.
 */
export function decodeOpenPayload(payload: ArrayBuffer | Uint8Array): OpenedPdf | null {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (data.byteLength === 0) return null;
  if (data.byteLength < 4) throw new Error("open_pdf payload too short");
  const nameLength = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
  if (4 + nameLength > data.byteLength) throw new Error("open_pdf payload truncated");
  const name = new TextDecoder().decode(data.subarray(4, 4 + nameLength));
  return { name, bytes: data.slice(4 + nameLength) };
}

/** Shows the native open dialog. Returns `null` if the user cancelled. */
export async function pickPdf(): Promise<OpenedPdf | null> {
  const payload = await invoke<ArrayBuffer>("open_pdf");
  return decodeOpenPayload(payload);
}

/** Tells the backend the last picked file was loaded and is now the source document. */
export async function acceptOpenedPdf(): Promise<void> {
  await invoke("accept_opened_pdf");
}

/** Error text `pick_signature_png` returns for an empty file (see EMPTY_FILE_ERROR in lib.rs). */
export const EMPTY_FILE_ERROR = "empty-file";

/**
 * Shows the native PNG dialog and returns the picked file's bytes, or `null`
 * if the user cancelled. An empty file comes back as zero bytes (not `null`),
 * so the caller rejects it like any other file that is not a PNG.
 */
export async function pickSignaturePng(): Promise<Uint8Array | null> {
  let payload: ArrayBuffer;
  try {
    payload = await invoke<ArrayBuffer>("pick_signature_png");
  } catch (error) {
    if (error === EMPTY_FILE_ERROR) return new Uint8Array();
    throw error;
  }
  return decodeSignaturePayload(payload);
}

/** An empty payload means the dialog was cancelled; anything else is the file. */
export function decodeSignaturePayload(payload: ArrayBuffer | Uint8Array): Uint8Array | null {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return data.byteLength === 0 ? null : data;
}

/** Error text `save_pdf` returns without an accepted document (SAVE_NO_DOCUMENT_ERROR in lib.rs). */
export const SAVE_NO_DOCUMENT_ERROR = "no-document";
/** Error text `save_pdf` returns for a body that is not raw, non-empty bytes (SAVE_INVALID_BODY_ERROR in lib.rs). */
export const SAVE_INVALID_BODY_ERROR = "invalid-body";

/**
 * Hands the signed PDF to the backend, which shows the native save dialog
 * (suggesting `<Name>_signiert.pdf` next to the source) and writes the file.
 * The bytes go as the raw IPC body. Returns the saved file's name, or `null`
 * if the user cancelled; rejects with the backend's error otherwise.
 */
export async function savePdf(bytes: Uint8Array): Promise<string | null> {
  const payload = await invoke<ArrayBuffer>("save_pdf", bytes);
  return decodeSavePayload(payload);
}

/** An empty payload means the dialog was cancelled; anything else is the UTF-8 file name. */
export function decodeSavePayload(payload: ArrayBuffer | Uint8Array): string | null {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return data.byteLength === 0 ? null : new TextDecoder().decode(data);
}
