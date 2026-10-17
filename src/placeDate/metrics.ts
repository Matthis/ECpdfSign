// Size of a place/date text box from the bundled font's metrics. The preview
// layout and the saved PDF both size the box from here, so they always agree.
// Pure: no DOM.

import type { Font, TypeFeatures } from "@pdf-lib/fontkit";

/**
 * fontkit (a large module) is only loaded once a text is inserted or saved,
 * so it stays out of the start-up bundle.
 */
export async function loadFontkit() {
  return (await import("@pdf-lib/fontkit")).default;
}

/**
 * Shaping used for measuring and for the PDF (pdf-lib lays out with the same
 * features): no ligatures, so every character keeps its own glyph and copied
 * text matches the input. pdf-lib ignores kerning when drawing, so the preview
 * turns it off as well (see `.placed-text` in styles.css).
 */
export const TEXT_FEATURES: TypeFeatures = {
  liga: false,
  clig: false,
  dlig: false,
  calt: false,
  rlig: false,
  kern: false,
};

/** Font size of a newly inserted text (PDF points). */
export const DEFAULT_FONT_SIZE = 11;
/** Smallest font size a text can be scaled down to (PDF points). */
export const MIN_FONT_SIZE = 6;

export interface FontMetrics {
  /** Ascender above the baseline at font size 1 (positive). */
  readonly ascent: number;
  /** Descender at font size 1 (negative: below the baseline). */
  readonly descent: number;
  /** Sum of the glyph advances of `text` at font size 1. */
  advance(text: string): number;
}

/** The font for place/date texts: its file (embedded when saving) and its metrics. */
export interface PlaceDateFont {
  readonly bytes: Uint8Array;
  readonly metrics: FontMetrics;
}

export interface TextBoxSize {
  width: number;
  height: number;
}

export function createFontMetrics(font: Font): FontMetrics {
  const unit = 1 / font.unitsPerEm;
  return {
    ascent: font.ascent * unit,
    descent: font.descent * unit,
    advance(text) {
      let total = 0;
      for (const glyph of font.layout(text, TEXT_FEATURES).glyphs) total += glyph.advanceWidth;
      return total * unit;
    },
  };
}

/** Parses a TrueType font file. The bytes are copied. */
export async function createPlaceDateFont(bytes: Uint8Array): Promise<PlaceDateFont> {
  const copy = bytes.slice();
  const fontkit = await loadFontkit();
  return { bytes: copy, metrics: createFontMetrics(fontkit.create(copy)) };
}

/**
 * The unrotated box of `text` at `fontSize`, in the same unit as `fontSize`:
 * the advance width by ascender minus descender. Its bottom edge is the
 * descender line, so the baseline lies `baselineOffset` above it.
 */
export function textBoxSize(metrics: FontMetrics, text: string, fontSize: number): TextBoxSize {
  return {
    width: metrics.advance(text) * fontSize,
    height: (metrics.ascent - metrics.descent) * fontSize,
  };
}

/** Distance from the box's bottom edge up to the baseline. */
export function baselineOffset(metrics: FontMetrics, fontSize: number): number {
  return -metrics.descent * fontSize;
}
