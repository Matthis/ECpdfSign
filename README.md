<div align="center">

<img src="app-icon.png" alt="ECpdfSign icon" width="140" />

# ECpdfSign

**Sign PDFs locally — drop in your handwritten signature, done.**

A lean desktop app for Windows 11 and macOS that places your signature (saved as a PNG) onto any PDF.
No cloud, no account, no upload. Your documents never leave your machine.

![Platforms](https://img.shields.io/badge/platform-Windows%2011%20%7C%20macOS-1D3FBF)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-vanilla-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-backend-000000?logo=rust&logoColor=white)
![Version](https://img.shields.io/badge/version-0.1.0-1D3FBF)
![Status](https://img.shields.io/badge/status-v1%20feature%20complete-2E9E5B)

</div>

---

## Why ECpdfSign?

Signing a PDF should not mean printing it, scanning it again, or uploading a contract to some online service.
Most "free" PDF signers either live in the cloud or come bundled in heavyweight office suites.

ECpdfSign does one thing well:

> Open a PDF → insert your signature → place it → save a signed copy.

It is small (a native Tauri app, typically a few MB), fast, and works completely offline.

## Features

| | Feature | Status |
|---|---|---|
| 📄 | Open a PDF and preview it. Multi-page documents get a thumbnail strip, like a print dialog | ✅ done |
| ✍️ | Insert your signature as a PNG with transparency. The page shows through, in the preview and in the saved PDF | ✅ done |
| 🖱️ | Move, scale and rotate signatures with the mouse. Place as many as you like, on any page | ✅ done |
| 📅 | Add place/date texts such as *München, 17.10.2026*: edited on the page, date from a calendar, any number of them | ✅ done |
| 🔤 | Full Unicode text (ä, ö, ü, ß, Ł, ø, …) with an embedded Noto Sans subset | ✅ done |
| 💾 | Save as a **new** PDF (suggested name `<Name>_signiert.pdf`). The original stays untouched unless you explicitly overwrite it | ✅ done |
| 🎯 | WYSIWYG: the saved PDF matches the preview, including rotated pages and offset crop boxes | ✅ done |
| ⚠️ | A warning before saving would invalidate existing digital signatures in the PDF | ✅ done |
| 🛟 | A prompt before opening another PDF discards unsaved work | ✅ done |
| 🔒 | 100 % local processing: no network access, strict content security policy | ✅ by design |

## Status

**Version 0.1.0: every v1 feature is implemented, tested and working on Windows 11 and macOS.**

- Downloads: a portable Windows EXE and a universal macOS DMG (Apple silicon and Intel) on the [Releases](https://github.com/Matthis/ECpdfSign/releases) page.
- About 400 automated tests, Vitest for the frontend and PDF output and `cargo test` for the backend. They run on Windows and, for every release, on macOS.
- Tested by hand on Windows 11 and macOS.
- Installers are **not code-signed** yet. On first start, Windows SmartScreen and macOS Gatekeeper will warn. Code signing is planned (see [Roadmap](#roadmap)).

### Known limitations

- Password-protected or encrypted PDFs cannot be opened yet; the app shows a message. Support is planned.
- Characters that Noto Sans does not have (e.g. CJK, emoji) appear as empty boxes in the saved PDF.
- Opaque annotations in the source PDF can cover a placed signature.
- Some special PNGs (interlaced, animated APNG, …) are rejected. Support is planned.

## How to use

The toolbar has four buttons, usable in any order:

| Button | What it does |
|---|---|
| **PDF Öffnen** | Opens a PDF. Pick a page in the thumbnail strip on the left. |
| **Ort/Datum einfügen** | Adds a place/date text next to the selected signature, or centered on the page. Type the place, pick the date. |
| **PNG Unterschrift einfügen** | Adds your signature PNG to the current page. |
| **Speichern** | Saves a signed copy through a "Save as" dialog. |

Working with placed elements:

- **Move:** drag with the left mouse button held down.
- **Scale:** corner handles keep the aspect ratio; edge handles stretch a signature. A text only scales, so its glyphs are never distorted.
- **Rotate:** drag the handle above the frame. It snaps at 0°/90°/180°/270°, and **Shift** rotates in 15° steps. Double-click the handle to reset to 0°.
- **Edit a text:** double-click it. **Enter** applies the edit, **Esc** discards it. The text can be moved, scaled and rotated while you edit.
- **Remove:** the **×** on the frame, or **Entf** / **Backspace**.

## ⚠️ Visual signature vs. digital signature

ECpdfSign adds a **visible image signature**, just like signing a printout by hand and scanning it.
This is fine for most everyday documents.

It is **not** a cryptographic digital signature (PAdES / advanced or qualified electronic signature under eIDAS).
If a document legally requires one, use a certificate-based signing tool.
Saving also invalidates digital signatures that are already in the PDF. ECpdfSign warns you before that happens.

## Tech stack

| Layer | Technology |
|---|---|
| App shell | [Tauri 2](https://tauri.app), using the OS webview (WebView2 / WebKit) |
| Backend | Rust: file dialogs, reading, atomic writing |
| Frontend | Vanilla TypeScript + Vite, no UI framework |
| PDF rendering | [pdf.js](https://mozilla.github.io/pdf.js/) |
| PDF writing | [pdf-lib](https://pdf-lib.js.org) + [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) |
| Font | [Noto Sans](https://notofonts.github.io) (SIL Open Font License 1.1) |

## Getting started

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) LTS
- **Windows:** Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 11)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

### Run in development mode

```bash
npm install
npm run tauri dev
```

### Run the tests

```bash
npm test                      # frontend and PDF output (Vitest)
cd src-tauri && cargo test    # backend
```

### Build an installer

```bash
npm run tauri build
```

The installers end up in `src-tauri/target/release/bundle/` (`.msi` / `.exe` on Windows, `.app` / `.dmg` on macOS).

## Project structure

```
ECpdfSign/
├── src/               # Frontend (TypeScript, HTML, CSS)
│   ├── pdf/           # pdf.js rendering and pdf-lib saving
│   ├── placeDate/     # Place/date formatting and font metrics
│   ├── signature/     # PNG checks and embedding
│   ├── ui/            # Toolbar, thumbnails, page view, overlay, editor
│   └── assets/fonts/  # Bundled Noto Sans (see its README)
├── src-tauri/         # Rust backend and Tauri configuration
│   └── icons/         # App icons (generated from app-icon.png)
├── _bmad/             # BMAD method configuration
├── _bmad-output/      # Spec, stories and implementation notes
├── app-icon.png       # Source icon (1024×1024)
└── app-icon.svg       # Editable vector source of the icon
```

To regenerate the app icons after changing `app-icon.png`, run `npm run tauri icon app-icon.png`.

## How this project is built

ECpdfSign is a slim [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) **Spec → Build** project, developed with [Claude Code](https://claude.com/claude-code).
The spec and its six stories live in [`_bmad-output/specs/spec-ecpdfsign`](./_bmad-output/specs/spec-ecpdfsign).
Every story went through a spec review, implementation, and a three-layer code review.

## Roadmap

- [x] Open and preview PDF, with a thumbnail strip
- [x] Insert PNG signature
- [x] Place, scale and rotate signatures
- [x] Save signed PDF
- [x] Optional place / date texts
- [x] Warning before invalidating existing digital signatures
- [x] Windows (portable EXE) and macOS (universal DMG) releases
- [ ] Remember the last used signature
- [ ] **Code-signed app:** a signed Windows installer and a signed and notarized macOS app, so there are no SmartScreen or Gatekeeper warnings
- [ ] **Password-protected PDFs:** open encrypted PDFs after asking for the password, and save the signed copy
- [ ] **Special PNGs:** accept interlaced, animated (APNG, first frame) and other unusual PNG variants as signatures

---

<div align="center">
<sub>Made with ✍️ and Rust · Your documents stay yours.</sub>
</div>
