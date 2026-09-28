#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod mdfile;
mod paths;
mod recovery;

use std::path::{Path, PathBuf};

use mdfile::Eol;
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedFile {
    #[serde(flatten)]
    file: mdfile::MdFile,
    /// Absolute path of the document.
    path: String,
    /// Base for `/…` image paths: the Git repo root, else the document folder.
    root: String,
    /// Fingerprint of the bytes on disk, to detect changes made elsewhere.
    hash: String,
}

/// Make `dir` (recursively) readable for the webview's asset protocol.
fn allow_assets(app: &tauri::AppHandle, dir: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(dir, true);
}

/// Read a Markdown file. Strict UTF-8 (4-byte sequences such as emoji are fine),
/// BOM and line endings are reported so saving can restore them exactly.
#[tauri::command]
fn read_markdown(app: tauri::AppHandle, path: String) -> Result<OpenedFile, String> {
    let abs = paths::absolute(Path::new(&path));
    let bytes = std::fs::read(&abs).map_err(|e| format!("{}: {e}", abs.display()))?;
    let file = mdfile::decode(&bytes).map_err(|e| format!("{}: {e}", abs.display()))?;
    let dir = abs.parent().map(Path::to_path_buf).unwrap_or_default();
    let root = paths::content_root(&dir);
    // images next to the document and anywhere in its repository
    allow_assets(&app, &dir);
    allow_assets(&app, &root);
    Ok(OpenedFile {
        file,
        path: abs.to_string_lossy().into_owned(),
        root: root.to_string_lossy().into_owned(),
        hash: mdfile::content_hash(&bytes),
    })
}

/// Save; refuses with `EXTERNAL_CHANGE` if the file on disk no longer has the
/// `expected` hash (changed by another program) unless `force`. Returns the new hash.
#[tauri::command]
fn write_markdown(
    app: tauri::AppHandle,
    path: String,
    text: String,
    eol: Eol,
    bom: bool,
    expected: Option<String>,
    force: bool,
) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let hash = mdfile::save_document(&p, &mdfile::encode(&text, eol, bom), expected.as_deref(), force).map_err(|e| match e {
        mdfile::SaveError::ExternalChange => mdfile::EXTERNAL_CHANGE.to_string(),
        mdfile::SaveError::Io(e) => format!("{path}: {e}"),
    })?;
    if let Some(dir) = p.parent() {
        allow_assets(&app, dir);
    }
    Ok(hash)
}

/// Current fingerprint of a file, `None` if it no longer exists.
#[tauri::command]
fn file_hash(path: String) -> Option<String> {
    std::fs::read(&path).ok().map(|b| mdfile::content_hash(&b))
}

/// Write a UTF-8 text file (e.g. the HTML export) atomically.
#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    mdfile::write_atomic(Path::new(&path), text.as_bytes()).map_err(|e| format!("{path}: {e}"))
}

/// Image files in `dir` (relative paths), for the "own images" picker.
#[tauri::command]
fn list_images(app: tauri::AppHandle, dir: String) -> Vec<String> {
    let dir = PathBuf::from(dir);
    allow_assets(&app, &dir);
    paths::list_images(&dir, 4, 500)
}

/// Running as administrator? (Explorer can't drag & drop into elevated windows.)
#[tauri::command]
fn is_elevated() -> bool {
    paths::is_elevated()
}

/// File passed on the command line ("Open with…" / drag onto the exe).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(|a| paths::absolute(Path::new(&a)).to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The window starts hidden and the frontend shows it once the editor is
            // rendered (no flash of the unstyled page). Fallback if that never happens:
            let window = app.get_webview_window("main").expect("main window");
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_markdown,
            write_markdown,
            write_text,
            file_hash,
            recovery::recovery_write,
            recovery::recovery_clear,
            recovery::recovery_orphans,
            recovery::recovery_remove,
            list_images,
            initial_file,
            is_elevated,
            cache::config_read,
            cache::config_write,
            cache::config_dir,
            cache::fetch_cached,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
