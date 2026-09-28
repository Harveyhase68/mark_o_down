//! Crash recovery. While a document has unsaved changes, the frontend keeps a
//! copy in `<app data>/recovery/<pid>.json`. It is removed on save/close. If the
//! app crashes (or Windows restarts), the file stays behind and the next start
//! offers to restore it. Files of instances that are still running are ignored.

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

fn recovery_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recovery"))
}

fn own_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(recovery_dir(app)?.join(format!("{}.json", std::process::id())))
}

/// Store the recovery copy of this instance (JSON written by the frontend).
#[tauri::command]
pub fn recovery_write(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = own_file(&app)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    crate::mdfile::write_atomic(&path, data.as_bytes()).map_err(|e| e.to_string())
}

/// Remove this instance's recovery copy (document saved, closed or discarded).
#[tauri::command]
pub fn recovery_clear(app: tauri::AppHandle) -> Result<(), String> {
    match std::fs::remove_file(own_file(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[derive(Serialize)]
pub struct Orphan {
    id: String,
    data: String,
}

/// Recovery copies left behind by instances that are no longer running.
#[tauri::command]
pub fn recovery_orphans(app: tauri::AppHandle) -> Result<Vec<Orphan>, String> {
    let dir = recovery_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    let own = std::process::id();
    let mut out = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(pid) = name.strip_suffix(".json").and_then(|s| s.parse::<u32>().ok()) else { continue };
        if pid == own || process_alive(pid) {
            continue;
        }
        if let Ok(data) = std::fs::read_to_string(e.path()) {
            out.push(Orphan { id: name, data });
        }
    }
    Ok(out)
}

/// Delete an orphaned recovery copy after it was restored or discarded.
#[tauri::command]
pub fn recovery_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let valid = id.strip_suffix(".json").is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    if !valid {
        return Err(format!("ungültige Wiederherstellungs-ID: {id}"));
    }
    match std::fs::remove_file(recovery_dir(&app)?.join(id)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Is a Mark O Down process with this id still running? (A reused pid that
/// belongs to another program counts as "not running".)
#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };

    // SAFETY: plain Win32 calls; the handle is closed before returning.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let running = GetExitCodeProcess(h, &mut code) != 0 && code == STILL_ACTIVE as u32;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let named = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(h);
        let exe = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
        running && named && exe.contains("mark_o_down")
    }
}

#[cfg(not(windows))]
fn process_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

#[cfg(test)]
mod tests {
    use super::process_alive;

    #[test]
    fn own_process_counts_as_running_only_if_it_is_mark_o_down() {
        // the test binary is named mark_o_down-<hash>.exe
        assert!(process_alive(std::process::id()));
        assert!(!process_alive(u32::MAX - 1));
    }
}
