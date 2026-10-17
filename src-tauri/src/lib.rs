use std::path::PathBuf;
use std::sync::Mutex;

use tauri::ipc::Response;
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
    /// Read by the save command (later story) to refuse overwriting the source.
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

/// Called by the frontend once the bytes from the last `open_pdf` loaded as a
/// supported PDF; that file becomes the current source document.
#[tauri::command]
fn accept_opened_pdf(state: State<'_, AppState>) {
    state.files().accept_pending();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![open_pdf, accept_opened_pdf])
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
