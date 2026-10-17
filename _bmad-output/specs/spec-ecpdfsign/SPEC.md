---
id: SPEC-ecpdfsign
companions: []
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# ECpdfSign

## Why

A vision with a privacy pain behind it: people who need to put their handwritten signature on a PDF (contracts, forms, letters) today either print–sign–scan or upload the document to a cloud signing service. ECpdfSign lets them place signature images, plus optional place and date lines, onto a PDF on their own Windows 11 or macOS machine. The document never leaves the computer.

## Capabilities

- **CAP-1**
  - **intent:** User opens a local PDF and picks the page to work on from scrollable thumbnails of all pages. The chosen page is shown large for placing elements.
  - **success:**
    - With a 10-page PDF open, the strip shows about 3 thumbnails at a time, and every page can be reached by scrolling.
    - Clicking a thumbnail opens that page legibly in the main view.
    - The thumbnail of the open page is visibly marked.
- **CAP-2**
  - **intent:** User loads a signature saved as a PNG with transparency.
  - **success:** A PNG with an alpha channel shows the underlying page content through its transparent areas, both in the preview and in the saved PDF.
- **CAP-3**
  - **intent:** User places any number of signatures on any pages, and moves, scales and rotates each one with the mouse.
  - **success:**
    - A signature moves only while it is grabbed with the left mouse button held down, and the preview updates live.
    - An active signature shows a frame:
      - its corner handles scale with a fixed aspect ratio;
      - its edge handles change width or height alone;
      - an "×" in its top-left corner removes the signature.
    - A rotation handle above the frame rotates the signature freely around its center:
      - the angle is shown while rotating;
      - it snaps at 0°, 90°, 180° and 270°;
      - Shift rotates in 15° steps;
      - a double-click resets it to 0°.
    - Twenty signatures across several pages can coexist.
- **CAP-4**
  - **intent:** User can optionally add any number of place/date texts in the format "<place>, <date>" (e.g. "München, 17.10.2026"). The date is DD.MM.YYYY, prefilled with today, and can be edited; the place is free text. Either part can be left out. Each text is placed like a signature: by default beside or below the selected signature, or centered on the current page if no signature is placed. Resizing changes the font size and never stretches the glyphs.
  - **success:**
    - With no edits, today's date appears next to or below the signature, or centered if there is none.
    - Several texts can be placed, moved, and resized independently, without distorted glyphs.
    - Clearing the place yields only the date; clearing the date yields only the place.
- **CAP-5**
  - **intent:** User saves the result as a new PDF; the save dialog suggests "<Name>_signiert.pdf". The original stays unchanged unless the user actively changes the name back to the original file and confirms the overwrite.
  - **success:**
    - Every signature and text appears in the saved PDF at the position, size and rotation shown in the preview, including on rotated pages and pages with a non-zero CropBox origin.
    - All other content and pages are unchanged.
    - Saved under the suggested or any other new name, the source file is byte-identical before and after.
    - Saved under the original name after the OS overwrite confirmation, the original is replaced by the signed version.
- **CAP-6**
  - **intent:** User removes the selected placed element (a signature or a place/date text).
  - **success:** After removal, the element is gone from the preview and from the next saved PDF. It can be inserted again.
- **CAP-7**
  - **intent:** User is warned before saving would invalidate digital signatures already present in the PDF.
  - **success:**
    - Saving a PDF that contains a signed signature field shows a warning before anything is written.
    - In the warning, "Abbrechen" writes nothing, and continuing saves the file.
    - A PDF without such signatures saves with no warning.

## Constraints

- No fixed workflow or wizard. A toolbar at the top has exactly five buttons, usable in any order:
  - "PDF Öffnen" (file open dialog)
  - "Ort/Datum einfügen"
  - "PNG Unterschrift einfügen"
  - "Element entfernen"
  - "Speichern" (save-as dialog)
- Layout below the toolbar, like a print dialog:
  - Left: a narrow, vertically scrollable strip of page thumbnails, sized so that about 3 are visible at once.
  - Right: the selected page, shown large, where signatures and texts are placed.
- WYSIWYG: what is shown in the preview is exactly what is saved, in position and size.
- The UI is in German.
- Fully local: no network access, cloud services, telemetry, or remote resources (fonts, CDNs).
- Place/date text uses a bundled, embedded Unicode-capable font; PDF standard fonts are not enough.
- Targets Windows 11 and macOS desktop.
- Stack is fixed: Tauri 2, vanilla TypeScript (no UI framework), pdf.js for rendering, pdf-lib for writing.
- The source PDF is never written implicitly: it is only overwritten when the user explicitly picks its name in the save dialog and confirms the overwrite.
- PDFs are untrusted input. The CSP (currently `null` in `src-tauri/tauri.conf.json`) must be locked down, with no remote origins, before shipping.
- Brownfield: the repo is the unmodified create-tauri-app vanilla-ts template. Keep the lib/bin crate split.

## Non-goals

- Cryptographic, advanced, or qualified electronic signatures (PAdES, certificates).
- Cloud features of any kind (sync, upload, online signing).
- PDF editing beyond inserting signatures and place/date texts (no page reordering, annotations, form filling, or text editing).
- Drawing or scanning a signature in the app; the user supplies the PNG.
- Password-protected or encrypted PDFs in v1 (planned for later). Opening one shows a clear message.
- Code signing and notarization in v1 (planned for later).

## Success signal

- A user opens a multi-page PDF, places a transparent PNG signature with "München, 17.10.2026" below it on page 3 and a second signature on page 5, and saves it as a new file.
  - In Adobe Acrobat Reader and macOS Preview, the new file shows every element where it was placed, with the page visible through the PNG's transparent areas.
  - The original file is byte-identical.
  - No network traffic occurred.

## Open Questions

- Can place/date texts be rotated like signatures? Decide in story 5.
