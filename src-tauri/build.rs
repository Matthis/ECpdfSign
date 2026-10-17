fn main() {
    // Declaring the app commands makes them permission-gated, so the
    // capability file has to grant each one explicitly.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_pdf",
            "accept_opened_pdf",
            "pick_signature_png",
            "save_pdf",
        ]),
    ))
    .expect("failed to run tauri-build");
}
