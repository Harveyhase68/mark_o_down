//! User configuration files and a small disk cache for remote data
//! (e.g. the Simple Icons index), so pickers work offline and start fast.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tauri::Manager;

/// Only plain file names inside the config folder (no paths).
fn config_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let valid = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.starts_with('.');
    if !valid {
        return Err(format!("ungültiger Konfigurationsname: {name}"));
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
pub fn config_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Contents of a config file, or `None` if it doesn't exist yet.
#[tauri::command]
pub fn config_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = config_file(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

#[tauri::command]
pub fn config_write(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    let path = config_file(&app, &name)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    crate::mdfile::write_atomic(&path, text.as_bytes()).map_err(|e| format!("{}: {e}", path.display()))
}

/// Stable file name for a URL.
fn cache_key(url: &str) -> String {
    format!("{}.cache", crate::mdfile::content_hash(url.as_bytes()))
}

fn is_fresh(path: &PathBuf, max_age: Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < max_age)
}

/// GET `url` as text, served from the disk cache while younger than
/// `max_age_hours`. If the network fails, a stale cached copy is returned.
/// `force` skips the freshness check (the "update now" button).
#[tauri::command]
pub async fn fetch_cached(app: tauri::AppHandle, url: String, max_age_hours: f64, force: bool) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("nur http(s)-Adressen erlaubt: {url}"));
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("remote");
    let path = dir.join(cache_key(&url));
    let max_age = Duration::from_secs_f64(max_age_hours.max(0.0) * 3600.0);

    if !force
        && is_fresh(&path, max_age)
        && let Ok(text) = std::fs::read_to_string(&path)
    {
        return Ok(text);
    }

    let fetched = tauri::async_runtime::spawn_blocking({
        let url = url.clone();
        move || -> Result<String, String> {
            // never hang the picker on a dead connection; the stale cache is used instead
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .timeout_connect(Some(Duration::from_secs(10)))
                .timeout_global(Some(Duration::from_secs(30)))
                .build()
                .into();
            let mut resp = agent.get(&url).call().map_err(|e| e.to_string())?;
            resp.body_mut().with_config().limit(20 * 1024 * 1024).read_to_string().map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    match fetched {
        Ok(text) => {
            let _ = std::fs::create_dir_all(&dir);
            let _ = crate::mdfile::write_atomic(&path, text.as_bytes());
            Ok(text)
        }
        // offline: better old data than none
        Err(e) => std::fs::read_to_string(&path).map_err(|_| format!("{url}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_stable_and_distinct() {
        assert_eq!(cache_key("https://a"), cache_key("https://a"));
        assert_ne!(cache_key("https://a"), cache_key("https://b"));
    }
}
