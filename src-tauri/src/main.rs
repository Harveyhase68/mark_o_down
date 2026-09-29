#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod mdfile;
mod paths;
mod recovery;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

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
    let file = mdfile::decode(&bytes)?; // INVALID_UTF8:<byte> – shown translated by the frontend
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

/// Save a pasted image (base64) as `<dir>/<subdir>/<stem>.<ext>` without overwriting
/// anything; returns the path relative to `dir` (e.g. `images/image-20260928-191530.png`).
#[tauri::command]
fn save_pasted_image(app: tauri::AppHandle, dir: String, subdir: String, stem: String, ext: String, data: String) -> Result<String, String> {
    use base64::Engine as _;
    if ![&subdir, &stem, &ext].iter().all(|s| paths::is_plain_name(s)) {
        return Err("invalid file name".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    let folder = PathBuf::from(&dir).join(&subdir);
    std::fs::create_dir_all(&folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let name = paths::unique_file_name(&folder, &stem, &ext);
    mdfile::write_atomic(&folder.join(&name), &bytes).map_err(|e| format!("{}: {e}", folder.join(&name).display()))?;
    allow_assets(&app, &folder);
    Ok(format!("{subdir}/{name}"))
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

/// Files handed to the running app by the system (macOS "Open with…" / double-click),
/// waiting to be picked up by the frontend.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

static ARGS_TAKEN: AtomicBool = AtomicBool::new(false);

/// A file to open: first the one on the command line ("Open with…" / drag onto the
/// exe on Windows and Linux), then the ones macOS hands over while the app runs.
/// Each is returned only once.
#[tauri::command]
fn initial_file(pending: tauri::State<PendingFiles>) -> Option<String> {
    if !ARGS_TAKEN.swap(true, Ordering::SeqCst)
        && let Some(a) = std::env::args().skip(1).find(|a| !a.starts_with('-'))
    {
        return Some(paths::absolute(Path::new(&a)).to_string_lossy().into_owned());
    }
    let mut files = pending.0.lock().ok()?;
    (!files.is_empty()).then(|| files.remove(0))
}

/// macOS: the app menu with our own "Quit", which closes the window like the close
/// button does – so unsaved changes are asked about instead of being lost.
#[cfg(target_os = "macos")]
fn mac_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let quit = MenuItem::with_id(app, "quit", "Quit Mark O Down", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Mark O Down",
        true,
        &[
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    // Cut/copy/paste/select all must be in the menu for their shortcuts to work in
    // the webview; undo/redo are the editor's own (toolbar, Cmd+Z).
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(mac_menu).on_menu_event(|app, event| {
        if event.id().as_ref() == "quit"
            && let Some(w) = app.get_webview_window("main")
        {
            let _ = w.close(); // the frontend asks about unsaved changes
        }
    });
    builder
        .manage(PendingFiles::default())
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
            save_pasted_image,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS hands over files ("Open with…", double-click) as an event, not as arguments
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let files = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned());
                if let Ok(mut pending) = app.state::<PendingFiles>().0.lock() {
                    pending.extend(files);
                }
                let _ = tauri::Emitter::emit(app, "open-file", ());
            }
            let _ = (app, event);
        });
}
