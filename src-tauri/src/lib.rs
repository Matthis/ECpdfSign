use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// Paths of the PDF the user picked. The frontend never sees or sends these.
///
/// `pending` is the file the last `open_pdf` call returned. It only becomes
/// `source` once the frontend reports (via `accept_opened_pdf`) that it could
/// load the document, so a rejected file (encrypted, corrupt) never replaces the
/// source of the document that is still shown.
#[derive(Default)]
struct SourceFiles {
    pending: Option<PathBuf>,
    /// The document that is shown; `save_pdf` suggests a name next to it.
    source: Option<PathBuf>,
}

impl SourceFiles {
    fn accept_pending(&mut self) {
        if let Some(path) = self.pending.take() {
            self.source = Some(path);
        }
    }
}

#[derive(Default)]
struct AppState {
    files: Mutex<SourceFiles>,
}

impl AppState {
    fn files(&self) -> std::sync::MutexGuard<'_, SourceFiles> {
        // A poisoned lock only means another command panicked mid-update; the
        // paths themselves are still consistent, so keep going.
        self.files.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Binary payload for `open_pdf`: `u32` little-endian byte length of the
/// UTF-8 file name, the file name, then the raw PDF bytes. An empty payload
/// means the dialog was cancelled.
fn encode_open_payload(file_name: &str, pdf: &[u8]) -> Vec<u8> {
    let name = file_name.as_bytes();
    let name_len = u32::try_from(name.len()).expect("file name longer than 4 GiB");
    let mut out = Vec::with_capacity(4 + name.len() + pdf.len());
    out.extend_from_slice(&name_len.to_le_bytes());
    out.extend_from_slice(name);
    out.extend_from_slice(pdf);
    out
}

/// Shows the native "open PDF" dialog, remembers the picked path and returns
/// its name and bytes (see [`encode_open_payload`]). The file is only read.
///
/// This must stay `async`: sync commands run on the main thread, where
/// `blocking_pick_file` would deadlock the event loop.
#[tauri::command]
async fn open_pdf(window: WebviewWindow, state: State<'_, AppState>) -> Result<Response, String> {
    let picked = window
        .dialog()
        .file()
        .set_title("PDF öffnen")
        .add_filter("PDF-Dokument", &["pdf"])
        .set_parent(&window)
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Ok(Response::new(Vec::new()));
    };
    let path = picked
        .into_path()
        .map_err(|_| "Der gewählte Speicherort wird nicht unterstützt.".to_string())?;

    let read_path = path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(read_path))
        .await
        .map_err(|e| format!("Die Datei konnte nicht gelesen werden ({e})."))?
        .map_err(|e| format!("Die Datei konnte nicht gelesen werden ({e})."))?;

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Dokument.pdf".to_string());

    state.files().pending = Some(path);
    Ok(Response::new(encode_open_payload(&file_name, &bytes)))
}

/// Error text returned by `pick_signature_png` when the picked file is empty.
/// An empty payload already means "cancelled", so an empty file needs its own
/// signal; the frontend treats it like any other file that is not a PNG.
/// Mirrored as `EMPTY_FILE_ERROR` in `src/backend.ts`; change both together.
const EMPTY_FILE_ERROR: &str = "empty-file";

/// Maps the outcome of the PNG dialog to the command's payload: no file (the
/// dialog was cancelled) is an empty payload, a file is its raw bytes.
fn signature_payload(picked: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    match picked {
        None => Ok(Vec::new()),
        Some(bytes) if bytes.is_empty() => Err(EMPTY_FILE_ERROR.to_string()),
        Some(bytes) => Ok(bytes),
    }
}

/// Shows the native "open PNG" dialog and returns the picked file's bytes. An
/// empty payload means the dialog was cancelled. Nothing is remembered: the
/// path never leaves this function.
///
/// `async` for the same reason as [`open_pdf`].
#[tauri::command]
async fn pick_signature_png(window: WebviewWindow) -> Result<Response, String> {
    let picked = window
        .dialog()
        .file()
        .set_title("PNG-Unterschrift einfügen")
        .add_filter("PNG-Bild", &["png"])
        .set_parent(&window)
        .blocking_pick_file();

    let bytes = match picked {
        None => None,
        Some(picked) => {
            let path = picked
                .into_path()
                .map_err(|_| "Der gewählte Speicherort wird nicht unterstützt.".to_string())?;
            let read = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
                .await
                .map_err(|e| format!("Die Datei konnte nicht gelesen werden ({e})."))?
                .map_err(|e| format!("Die Datei konnte nicht gelesen werden ({e})."))?;
            Some(read)
        }
    };
    Ok(Response::new(signature_payload(bytes)?))
}

/// Called by the frontend once the bytes from the last `open_pdf` loaded as a
/// supported PDF; that file becomes the current source document.
#[tauri::command]
fn accept_opened_pdf(state: State<'_, AppState>) {
    state.files().accept_pending();
}

/// Error text `save_pdf` returns when no document has been accepted yet.
/// Mirrored as `SAVE_NO_DOCUMENT_ERROR` in `src/backend.ts`; change both together.
const SAVE_NO_DOCUMENT_ERROR: &str = "no-document";

/// Error text `save_pdf` returns when the request body is not raw, non-empty
/// PDF bytes. Mirrored as `SAVE_INVALID_BODY_ERROR` in `src/backend.ts`.
const SAVE_INVALID_BODY_ERROR: &str = "invalid-body";

/// Folder and file name the save dialog suggests for `source`: the source's
/// folder and `<Name>_signiert.pdf`, where `<Name>` is the source file name
/// without its `.pdf` extension (any case).
fn suggested_save_target(source: &Path) -> (Option<PathBuf>, String) {
    let folder = source
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf);
    let is_pdf = source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    let stem = if is_pdf {
        source.file_stem()
    } else {
        source.file_name()
    };
    let stem = stem
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Dokument".to_string());
    (folder, format!("{stem}_signiert.pdf"))
}

/// Removes the temporary file unless the write completed.
struct TempFileGuard<'a> {
    path: &'a Path,
    keep: bool,
}

impl Drop for TempFileGuard<'_> {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_file(self.path);
        }
    }
}

/// Writes `bytes` to `target` without ever leaving a partial file: the data
/// goes to a new temporary file in the target's folder, is flushed to disk and
/// then renamed over `target` (replacing an existing file). On any error the
/// temporary file is removed and `target` is untouched.
fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let folder = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    if target.file_name().is_none() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"));
    }

    // A short fixed name, so a target name near the 255-character limit still
    // works. `create_new` never reuses an existing file; retry with the next
    // number if one exists.
    let (temp_path, mut file) = loop {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = folder.join(format!(".ecpdfsign-{}-{n}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => break (candidate, file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let mut guard = TempFileGuard {
        path: &temp_path,
        keep: false,
    };

    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp_path, target)?;
    guard.keep = true;
    Ok(())
}

/// Shows the native "save as" dialog, suggesting `<Name>_signiert.pdf` in the
/// source document's folder, and writes the request body (the raw bytes of
/// the signed PDF) to the picked file via [`write_atomically`]. Returns the
/// saved file's name as UTF-8; an empty payload means the dialog was
/// cancelled and nothing was written. The source is only replaced if the user
/// picks its name and confirms the dialog's overwrite prompt.
///
/// `async` for the same reason as [`open_pdf`].
#[tauri::command]
async fn save_pdf(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<Response, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) if !bytes.is_empty() => bytes.clone(),
        _ => return Err(SAVE_INVALID_BODY_ERROR.to_string()),
    };
    let source = state
        .files()
        .source
        .clone()
        .ok_or_else(|| SAVE_NO_DOCUMENT_ERROR.to_string())?;
    let (folder, file_name) = suggested_save_target(&source);

    let mut dialog = window
        .dialog()
        .file()
        .set_title("PDF speichern")
        .add_filter("PDF-Dokument", &["pdf"])
        .set_file_name(file_name)
        .set_parent(&window);
    if let Some(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(Response::new(Vec::new()));
    };
    let target = picked
        .into_path()
        .map_err(|_| "Der gewählte Speicherort wird nicht unterstützt.".to_string())?;

    let saved_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || write_atomically(&target, &bytes))
        .await
        .map_err(|e| format!("Die Datei konnte nicht gespeichert werden ({e})."))?
        .map_err(|e| format!("Die Datei konnte nicht gespeichert werden ({e})."))?;
    Ok(Response::new(saved_name.into_bytes()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_pdf,
            accept_opened_pdf,
            pick_signature_png,
            save_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_carries_name_then_bytes() {
        let payload = encode_open_payload("Vertrag Ü.pdf", b"%PDF-1.7");
        let name = "Vertrag Ü.pdf".as_bytes();
        assert_eq!(&payload[..4], &(name.len() as u32).to_le_bytes());
        assert_eq!(&payload[4..4 + name.len()], name);
        assert_eq!(&payload[4 + name.len()..], b"%PDF-1.7");
    }

    /// Golden vector shared with `src/backend.test.ts`; change both together.
    const GOLDEN_PAYLOAD: [u8; 14] = [
        6, 0, 0, 0, // name length (u32 LE)
        0xC3, 0x9C, b'.', b'p', b'd', b'f', // "Ü.pdf" (UTF-8)
        b'%', b'P', b'D', b'F', // file bytes
    ];

    #[test]
    fn payload_matches_golden_vector() {
        assert_eq!(encode_open_payload("Ü.pdf", b"%PDF"), GOLDEN_PAYLOAD);
    }

    #[test]
    fn payload_of_empty_file_is_not_empty() {
        // An empty payload means "cancelled", so a 0-byte file must still
        // produce a non-empty payload.
        assert!(!encode_open_payload("leer.pdf", b"").is_empty());
    }

    #[test]
    fn signature_cancel_is_empty_payload() {
        assert_eq!(signature_payload(None), Ok(Vec::new()));
    }

    #[test]
    fn signature_payload_is_the_file_bytes() {
        let png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(signature_payload(Some(png.clone())), Ok(png));
    }

    #[test]
    fn empty_file_error_matches_frontend_literal() {
        // `src/backend.ts` matches this exact string; change both together.
        assert_eq!(EMPTY_FILE_ERROR, "empty-file");
    }

    /// Command names listed in build.rs' `AppManifest::commands(&[...])`.
    fn manifest_commands(build_rs: &str) -> Vec<String> {
        let start = build_rs
            .find(".commands(&[")
            .expect("build.rs declares the app commands")
            + ".commands(&[".len();
        let end = start + build_rs[start..].find(']').expect("command list is closed");
        build_rs[start..end]
            .split(',')
            .map(|item| item.trim().trim_matches('"').to_string())
            .filter(|name| !name.is_empty())
            .collect()
    }

    #[test]
    fn every_manifest_command_is_granted_to_the_main_window() {
        let commands = manifest_commands(include_str!("../build.rs"));
        assert!(commands.contains(&"pick_signature_png".to_string()));
        assert!(commands.contains(&"save_pdf".to_string()));
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("default.json is valid JSON");
        let granted: Vec<&str> = capability["permissions"]
            .as_array()
            .expect("permissions array")
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        for command in commands {
            let permission = format!("allow-{}", command.replace('_', "-"));
            assert!(
                granted.contains(&permission.as_str()),
                "{permission} missing from capabilities/default.json"
            );
        }
    }

    #[test]
    fn empty_signature_file_is_not_a_cancel() {
        // Must not collapse into the empty "cancelled" payload.
        assert_eq!(
            signature_payload(Some(Vec::new())),
            Err(EMPTY_FILE_ERROR.to_string())
        );
    }

    #[test]
    fn save_error_literals_match_frontend() {
        // `src/backend.ts` mirrors these exact strings; change both together.
        assert_eq!(SAVE_NO_DOCUMENT_ERROR, "no-document");
        assert_eq!(SAVE_INVALID_BODY_ERROR, "invalid-body");
    }

    #[test]
    fn suggests_signiert_name_in_source_folder() {
        let source = Path::new("docs").join("Vertrag.pdf");
        assert_eq!(
            suggested_save_target(&source),
            (Some(PathBuf::from("docs")), "Vertrag_signiert.pdf".to_string())
        );
    }

    #[test]
    fn suggestion_strips_pdf_extension_in_any_case_only() {
        assert_eq!(suggested_save_target(Path::new("Ü Vertrag.PDF")).1, "Ü Vertrag_signiert.pdf");
        assert_eq!(suggested_save_target(Path::new("a.b.pdf")).1, "a.b_signiert.pdf");
        assert_eq!(suggested_save_target(Path::new("scan")).1, "scan_signiert.pdf");
        assert_eq!(suggested_save_target(Path::new("scan.txt")).1, "scan.txt_signiert.pdf");
        // A bare file name has no folder to suggest.
        assert_eq!(suggested_save_target(Path::new("Vertrag.pdf")).0, None);
    }

    /// A fresh, empty folder under the system temp dir, removed on drop.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "ecpdfsign-test-{name}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            TestDir(dir)
        }

        fn entries(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn atomic_write_creates_a_new_file() {
        let dir = TestDir::new("new");
        let target = dir.0.join("Vertrag_signiert.pdf");
        write_atomically(&target, b"%PDF-1.7 signed").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-1.7 signed");
        assert_eq!(dir.entries(), vec!["Vertrag_signiert.pdf"]);
    }

    #[test]
    fn atomic_write_replaces_an_existing_file() {
        let dir = TestDir::new("replace");
        let target = dir.0.join("Vertrag.pdf");
        fs::write(&target, b"%PDF-1.4 original, longer than the new content").unwrap();
        write_atomically(&target, b"%PDF-1.7 signed").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-1.7 signed");
        assert_eq!(dir.entries(), vec!["Vertrag.pdf"]);
    }

    #[test]
    fn atomic_write_handles_a_target_name_at_the_length_limit() {
        let dir = TestDir::new("long");
        // 255 bytes, the usual limit for one path component.
        let name = format!("{}.pdf", "a".repeat(251));
        let target = dir.0.join(&name);
        write_atomically(&target, b"%PDF-1.7 signed").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-1.7 signed");
        assert_eq!(dir.entries(), vec![name]);
    }

    #[test]
    fn failed_atomic_write_leaves_no_temp_file() {
        let dir = TestDir::new("fail");
        // A folder in the target's place: the temp file is written, but the
        // rename over it fails on every platform.
        let target = dir.0.join("Vertrag.pdf");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("inhalt.txt"), b"x").unwrap();

        assert!(write_atomically(&target, b"%PDF-1.7 signed").is_err());

        assert_eq!(dir.entries(), vec!["Vertrag.pdf"]);
        assert!(target.is_dir());
        assert_eq!(fs::read(target.join("inhalt.txt")).unwrap(), b"x");
    }

    #[test]
    fn atomic_write_into_a_missing_folder_fails_without_creating_it() {
        let dir = TestDir::new("missing");
        let target = dir.0.join("fehlt").join("Vertrag.pdf");
        assert!(write_atomically(&target, b"%PDF").is_err());
        assert!(dir.entries().is_empty());
    }

    #[test]
    fn accept_promotes_pending_path() {
        let mut files = SourceFiles {
            pending: Some(PathBuf::from("b.pdf")),
            source: Some(PathBuf::from("a.pdf")),
        };
        files.accept_pending();
        assert_eq!(files.source, Some(PathBuf::from("b.pdf")));
        assert_eq!(files.pending, None);
    }

    #[test]
    fn accept_without_pending_keeps_source() {
        let mut files = SourceFiles {
            pending: None,
            source: Some(PathBuf::from("a.pdf")),
        };
        files.accept_pending();
        assert_eq!(files.source, Some(PathBuf::from("a.pdf")));
    }
}
