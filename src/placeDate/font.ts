// Browser-only: loads the bundled place/date font from the app itself. The
// same file backs the preview's @font-face (styles.css), so preview and PDF
// use one font. Never fetched from anywhere but the app bundle.

import fontUrl from "../assets/fonts/NotoSans-Regular.ttf?url";
import { createPlaceDateFont, type PlaceDateFont } from "./metrics";

export async function loadBundledFont(): Promise<PlaceDateFont> {
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error(`font request failed: ${response.status}`);
  const font = await createPlaceDateFont(new Uint8Array(await response.arrayBuffer()));
  // Let the preview's @font-face finish too, so the first text never shows in a fallback.
  await document.fonts.load('16px "ECpdfSign Text"').catch(() => undefined);
  return font;
}
