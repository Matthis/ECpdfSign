// Test helper: the bundled place/date font, inlined by Vite (Node tests cannot fetch it).

import fontDataUrl from "../assets/fonts/NotoSans-Regular.ttf?inline";
import { createPlaceDateFont, type PlaceDateFont } from "./metrics";

function decodeDataUrl(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export const FONT_BYTES = decodeDataUrl(fontDataUrl);

const font: PlaceDateFont = await createPlaceDateFont(FONT_BYTES);
export function bundledFont(): PlaceDateFont {
  return font;
}
