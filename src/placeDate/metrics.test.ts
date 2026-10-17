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
