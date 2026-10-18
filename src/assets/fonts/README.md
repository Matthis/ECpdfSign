# Bundled fonts

## NotoSans-Regular.ttf

- **Source:** Noto Sans Regular, version 2.015, by the Noto Project Authors
  (<https://github.com/notofonts/latin-greek-cyrillic>).
- **License:** SIL Open Font License 1.1, see `OFL.txt`. The license names no
  Reserved Font Name, so the modified file keeps its name.
- **Used for:** place/date texts, both in the preview (`@font-face` in
  `src/styles.css`) and as the font subset embedded in the saved PDF
  (`src/placeDate/font.ts`, `src/pdf/save.ts`).

### Modification: 4-byte glyph padding

The file is the upstream font re-saved with fontTools, with every glyph in
`glyf` padded to a multiple of 4 bytes. Compared with upstream and found
unchanged: the glyph outlines, the glyph order, the advances (`hmtx`) and the
vertical metrics (1000 units per em, ascender 1069, descender −293). fontTools
may also rewrite bookkeeping on save, such as `head.modified`, the table
checksums and recomputed bounding boxes; those were not compared.

Why: about 1100 of the 3884 upstream glyphs have an odd byte length. That is
valid, because upstream uses long `loca` offsets. But `@pdf-lib/fontkit`'s
subsetter (`TTFSubset`) copies glyph data into the subset unpadded and then
writes short `loca` offsets (offset / 2) whenever the subset is small. After
the first odd-length glyph, every glyph offset in the subset is off, so the
saved PDF drew the wrong outlines ("München, 18.10.2026" showed as
"   e   1   1   6"). Copying the text out still worked, because ToUnicode was
correct. With every glyph an even length, the short offsets are exact.

`src/placeDate/metrics.test.ts` checks that every glyph has an even length,
and `src/pdf/save.test.ts` compares the embedded subset's outlines with this
file. Re-apply the padding if the font is ever replaced or updated:

```sh
uv run --no-project --with fonttools python -I -c "from fontTools.ttLib import TTFont; import sys; f=TTFont(sys.argv[1]); f['glyf'].padding=4; f.save(sys.argv[2])" in.ttf out.ttf
```
