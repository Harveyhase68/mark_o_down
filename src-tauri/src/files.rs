//! The folder tree: list a folder, the drives, find files by name below a folder.
//! Only folders and Markdown files are shown; hidden ones (`.git`, Windows' hidden and
//! system entries like `$RECYCLE.BIN`) are left out.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const MARKDOWN: [&str; 6] = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn"];
/// Folders the search does not go into (big, never documentation).
const SKIP: [&str; 4] = ["node_modules", "target", "vendor", "__pycache__"];

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
}

#[derive(Serialize, Debug)]
pub struct Found {
    /// relative to the folder searched, with `/`
    pub path: String,
    pub dir: bool,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub found: Vec<Found>,
    /// stopped early (limit, time) – there may be more
    pub more: bool,
    /// a newer search replaced this one
    pub cancelled: bool,
}

fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MARKDOWN.iter().any(|m| m.eq_ignore_ascii_case(e)))
}

fn hidden(entry: &std::fs::DirEntry, name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if let Ok(m) = entry.metadata() {
            return m.file_attributes() & (HIDDEN | SYSTEM) != 0;
        }
    }
    #[cfg(not(windows))]
    let _ = entry;
    false
}

/// What is shown of a folder: (name, is folder), unsorted.
fn entries(dir: &Path) -> std::io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if hidden(&entry, &name) {
            continue;
        }
        // follows links: a linked folder is a folder
        let dir = entry.path().is_dir();
        if dir || is_markdown(&name) {
            out.push(Entry { name, dir });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || entries(Path::new(&path)).map_err(|e| format!("{path}: {e}")))
        .await
        .map_err(|e| e.to_string())?
}

/// "file", "dir" or nothing (does not exist).
#[tauri::command]
pub fn path_kind(path: String) -> Option<&'static str> {
    let m = std::fs::metadata(path).ok()?;
    Some(if m.is_dir() { "dir" } else { "file" })
}

/// Where one can start: the drives (Windows), else `/` and the home folder.
#[tauri::command]
pub fn list_roots() -> Vec<String> {
    #[cfg(windows)]
    {
        let mask = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() };
        (0..26).filter(|i| mask & (1 << i) != 0).map(|i| format!("{}:\\", (b'A' + i as u8) as char)).collect()
    }
    #[cfg(not(windows))]
    {
        let mut roots = vec!["/".to_string()];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(home.to_string_lossy().into_owned());
        }
        roots
    }
}

static SEARCH: AtomicU64 = AtomicU64::new(0);

/// Files and folders below `root` whose name contains `query` (case-insensitive; with a
/// `/` in it: the relative path). Breadth first – near ones first; at most `limit`
/// results and about two seconds. A newer search cancels this one.
#[tauri::command]
pub async fn find_files(root: String, query: String, limit: usize) -> SearchResult {
    let id = SEARCH.fetch_add(1, Ordering::SeqCst) + 1;
    let cancelled = move || SEARCH.load(Ordering::SeqCst) != id;
    tauri::async_runtime::spawn_blocking(move || search(Path::new(&root), &query, limit, Duration::from_secs(2), cancelled))
        .await
        .unwrap_or(SearchResult { found: vec![], more: false, cancelled: true })
}

fn search(root: &Path, query: &str, limit: usize, time: Duration, cancelled: impl Fn() -> bool) -> SearchResult {
    let query = query.trim().replace('\\', "/").to_lowercase();
    let by_path = query.contains('/');
    let start = Instant::now();
    let mut found = Vec::new();
    let mut queue: std::collections::VecDeque<(PathBuf, String)> = [(root.to_path_buf(), String::new())].into();
    while let Some((dir, rel)) = queue.pop_front() {
        if cancelled() {
            return SearchResult { found, more: false, cancelled: true };
        }
        if start.elapsed() > time {
            return SearchResult { found, more: true, cancelled: false };
        }
        let Ok(mut list) = entries(&dir) else { continue };
        list.sort_by_key(|e| (!e.dir, e.name.to_lowercase()));
        for e in list {
            let path = if rel.is_empty() { e.name.clone() } else { format!("{rel}/{}", e.name) };
            let hay = if by_path { path.to_lowercase() } else { e.name.to_lowercase() };
            if hay.contains(&query) {
                if found.len() == limit {
                    return SearchResult { found, more: true, cancelled: false };
                }
                found.push(Found { path: path.clone(), dir: e.dir });
            }
            if e.dir && !SKIP.contains(&e.name.as_str()) {
                queue.push_back((dir.join(&e.name), path));
            }
        }
    }
    SearchResult { found, more: false, cancelled: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mod-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for d in ["docs/sub", ".git", "node_modules/x"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in ["Lizenz.md", "README.md", "bild.png", "docs/Blizzard.md", "docs/sub/lizzard.markdown", ".git/liz.md", "node_modules/x/liz.md"] {
            std::fs::write(root.join(f), "x").unwrap();
        }
        root
    }

    #[test]
    fn lists_folders_and_markdown_only() {
        let root = tree("list");
        let mut list = entries(&root).unwrap();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        let names: Vec<_> = list.iter().map(|e| (e.name.as_str(), e.dir)).collect();
        assert_eq!(names, [("Lizenz.md", false), ("README.md", false), ("docs", true), ("node_modules", true)]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn finds_by_part_of_the_name_near_ones_first() {
        let root = tree("search");
        let r = search(&root, "LIZ", 100, Duration::from_secs(5), || false);
        let paths: Vec<_> = r.found.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["Lizenz.md", "docs/Blizzard.md", "docs/sub/lizzard.markdown"]);
        assert!(!r.more);
        let r = search(&root, "sub/liz", 100, Duration::from_secs(5), || false);
        assert_eq!(r.found.len(), 1);
        let r = search(&root, "liz", 1, Duration::from_secs(5), || false);
        assert!(r.more && r.found.len() == 1);
        let _ = std::fs::remove_dir_all(root);
    }
}
