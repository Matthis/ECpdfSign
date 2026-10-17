// Insert-time check that pdf-lib can embed a signature PNG, so saving never
// fails because of an image. Pure: no DOM.

import { PDFDocument } from "pdf-lib";

/**
 * Embeds the PNG once into a throwaway pdf-lib document, exactly as saving
 * will (decode, split off the alpha channel, compress). Rejects if pdf-lib
 * cannot, e.g. for animated PNGs. `bytes` is not modified.
 */
export async function checkPngEmbeddable(bytes: Uint8Array): Promise<void> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const image = await doc.embedPng(bytes.slice());
  await image.embed();
}
