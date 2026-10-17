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
