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
![Status](https://img.shields.io/badge/status-early%20development-E8962A)

</div>

---

## Why ECpdfSign?

Signing a PDF should not mean printing it, scanning it again, or uploading a contract to some online service.
Most "free" PDF signers either live in the cloud or come bundled in heavyweight office suites.

ECpdfSign does one thing well:

> Open a PDF → load your signature → place it → save a signed copy.

It is small (a native Tauri app, typically a few MB), fast, and works completely offline.

## Features

| | Feature | Status |
|---|---|---|
| 📄 | Open a PDF and preview it, including multi-page documents | 🛠️ planned |
| ✍️ | Load your signature as a PNG with transparency | 🛠️ planned |
| 🖱️ | Place and resize the signature with the mouse | 🛠️ planned |
| 📅 | Optionally add date and place, e.g. *München, 17.10.2026* | 🛠️ planned |
| 💾 | Save as a **new** PDF — the original stays untouched | 🛠️ planned |
| 🔒 | 100 % local processing, no network access needed | ✅ by design |

## ⚠️ Visual signature vs. digital signature

ECpdfSign adds a **visible image signature**, just like signing a printout by hand and scanning it.
This is fine for most everyday documents.

It is **not** a cryptographic digital signature (PAdES / advanced or qualified electronic signature under eIDAS).
If a document legally requires one, use a certificate-based signing tool.

## Tech stack

| Layer | Technology |
|---|---|
| App shell | [Tauri 2](https://tauri.app) — uses the OS webview (WebView2 / WebKit) |
| Backend | Rust |
| Frontend | Vanilla TypeScript + Vite |
| PDF rendering | [pdf.js](https://mozilla.github.io/pdf.js/) |
| PDF writing | [pdf-lib](https://pdf-lib.js.org) |

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

### Build an installer

```bash
npm run tauri build
```

The installers end up in `src-tauri/target/release/bundle/` (`.msi` / `.exe` on Windows, `.app` / `.dmg` on macOS).

## Project structure

```
ECpdfSign/
├── src/               # Frontend (TypeScript, HTML, CSS)
├── src-tauri/         # Rust backend and Tauri configuration
│   └── icons/         # App icons (generated from app-icon.png)
├── _bmad/             # BMAD method configuration
├── _bmad-output/      # Specs and stories created with BMAD
├── app-icon.png       # Source icon (1024×1024)
└── app-icon.svg       # Editable vector source of the icon
```

## How this project is built

ECpdfSign is a slim [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) **Spec → Build** project, developed with [Claude Code](https://claude.com/claude-code).
Specs and stories live in [`_bmad-output/`](./_bmad-output).

## Roadmap

- [ ] Open and preview PDF
- [ ] Load PNG signature
- [ ] Place and resize signature
- [ ] Save signed PDF
- [ ] Optional date / place
- [ ] macOS build
- [ ] Remember last used signature

---

<div align="center">
<sub>Made with ✍️ and Rust · Your documents stay yours.</sub>
</div>
