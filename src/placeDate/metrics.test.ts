import { describe, expect, it } from "vitest";
import css from "../styles.css?raw";
import { bundledFont, FONT_BYTES } from "./fontFixture.test-data";
import { baselineOffset, loadFontkit, textBoxSize } from "./metrics";

describe("place/date font metrics", () => {
  const { metrics } = bundledFont();

  it("reads Noto Sans' vertical metrics (per unit font size)", () => {
    expect(metrics.ascent).toBeCloseTo(1.069, 6);
    expect(metrics.descent).toBeCloseTo(-0.293, 6);
  });

  it("sizes the box as advance width by ascender minus descender, linear in the font size", () => {
    const at11 = textBoxSize(metrics, "München, 17.10.2026", 11);
    const at22 = textBoxSize(metrics, "München, 17.10.2026", 22);
    expect(at11.height).toBeCloseTo(11 * 1.362, 9);
    expect(at11.width).toBeGreaterThan(0);
    expect(at22.width).toBeCloseTo(2 * at11.width, 9);
    expect(at22.height).toBeCloseTo(2 * at11.height, 9);
    expect(baselineOffset(metrics, 10)).toBeCloseTo(2.93, 9);
  });

  it("adds up plain advances: no kerning, no ligatures", () => {
    // "fi" is a ligature in Noto Sans and "AV" a kerning pair; neither may change the width.
    expect(metrics.advance("fi")).toBeCloseTo(metrics.advance("f") + metrics.advance("i"), 9);
    expect(metrics.advance("AV")).toBeCloseTo(metrics.advance("A") + metrics.advance("V"), 9);
    expect(metrics.advance("")).toBe(0);
  });

  it("stores every glyph with an even byte length, as fontkit's subsetting needs", () => {
    // fontkit copies glyphs unpadded into the subset, yet writes short `loca`
    // offsets (offset / 2) for small subsets: one odd glyph shifts every glyph
    // after it. The bundled file is therefore re-saved with 4-byte padding
    // (see assets/fonts/README.md); a swapped-in font must be too.
    const view = new DataView(FONT_BYTES.buffer, FONT_BYTES.byteOffset, FONT_BYTES.byteLength);
    const tables = new Map<string, { offset: number; length: number }>();
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + 16 * i;
      const tag = String.fromCharCode(...FONT_BYTES.subarray(record, record + 4));
      tables.set(tag, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) });
    }
    const head = tables.get("head")!;
    const loca = tables.get("loca")!;
    const longOffsets = view.getInt16(head.offset + 50) === 1;
    const glyphCount = view.getUint16(tables.get("maxp")!.offset + 4);
    const offsetAt = (i: number) =>
      longOffsets ? view.getUint32(loca.offset + 4 * i) : 2 * view.getUint16(loca.offset + 2 * i);
    expect(loca.length).toBe((glyphCount + 1) * (longOffsets ? 4 : 2));
    const odd: number[] = [];
    for (let i = 0; i < glyphCount; i++) {
      if ((offsetAt(i + 1) - offsetAt(i)) % 2 !== 0) odd.push(i);
    }
    expect(glyphCount).toBeGreaterThan(3000);
    expect(odd).toEqual([]);
  });

  it("has a glyph for every character of the place names the app must render", async () => {
    const font = (await loadFontkit()).create(FONT_BYTES);
    for (const char of "Łódź Ærøskøbing Zürich München, 0123456789.") {
      expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), char).toBe(true);
    }
  });
});

describe("preview @font-face", () => {
  it("pins ascent/descent to the font's own metrics, as the box layout assumes", () => {
    const { metrics } = bundledFont();
    const face = /@font-face\s*{[^}]*"ECpdfSign Text"[^}]*}/.exec(css)?.[0] ?? "";
    const percent = (name: string) => Number(new RegExp(`${name}:\\s*([\\d.]+)%`).exec(face)?.[1]);
    expect(percent("ascent-override") / 100).toBeCloseTo(metrics.ascent, 3);
    expect(percent("descent-override") / 100).toBeCloseTo(-metrics.descent, 3);
    expect(percent("line-gap-override")).toBe(0);
  });
});
