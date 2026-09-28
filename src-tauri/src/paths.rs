//! Path helpers: absolute document paths and the "root" for `/…` image paths.

use std::path::{Path, PathBuf};

/// Absolute, normalized path without the `\\?\` prefix Windows' canonicalize adds.
pub fn absolute(path: &Path) -> PathBuf {
    let abs = std::fs::canonicalize(path)
        .or_else(|_| std::path::absolute(path))
        .unwrap_or_else(|_| path.to_path_buf());
    strip_verbatim(abs)
}

pub fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

/// Root for site-absolute image paths (`/docs/logo.png`), like GitHub does:
/// the enclosing Git repository, otherwise the document's folder.
pub fn content_root(doc_dir: &Path) -> PathBuf {
    doc_dir
        .ancestors()
        .find(|d| d.join(".git").exists())
        .unwrap_or(doc_dir)
        .to_path_buf()
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico"];
const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist", "build", ".next", "vendor", "__pycache__"];

/// Image files below `dir` (relative, with `/`), breadth-first, limited.
pub fn list_images(dir: &Path, max_depth: usize, max_files: usize) -> Vec<String> {
    let is_image = |p: &Path| {
        p.extension()
            .is_some_and(|x| IMAGE_EXT.contains(&x.to_string_lossy().to_lowercase().as_str()))
    };
    let mut out = Vec::new();
    let mut queue = std::collections::VecDeque::from([(dir.to_path_buf(), 0usize)]);
    while let Some((d, depth)) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() {
                if depth < max_depth && !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_str()) {
                    queue.push_back((p, depth + 1));
                }
            } else if is_image(&p)
                && let Ok(rel) = p.strip_prefix(dir)
            {
                out.push(rel.to_string_lossy().replace('\\', "/"));
                if out.len() >= max_files {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbatim_prefix_is_removed() {
        assert_eq!(strip_verbatim(PathBuf::from(r"\\?\C:\a\b.md")), PathBuf::from(r"C:\a\b.md"));
        assert_eq!(strip_verbatim(PathBuf::from(r"\\?\UNC\srv\share\x.md")), PathBuf::from(r"\\srv\share\x.md"));
    }

    #[test]
    fn root_is_git_repo_or_doc_dir() {
        let base = std::env::temp_dir().join(format!("mod_root_{}", std::process::id()));
        let docs = base.join("repo").join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        assert_eq!(content_root(&docs), docs);
        std::fs::create_dir_all(base.join("repo").join(".git")).unwrap();
        std::fs::write(docs.join("a.png"), b"x").unwrap();
        assert_eq!(content_root(&docs), base.join("repo"));
        assert_eq!(list_images(&base.join("repo"), 3, 10), vec!["docs/a.png".to_string()]);
        std::fs::remove_dir_all(&base).unwrap();
    }
}

/// Whether this process runs elevated (as administrator). Windows then blocks
/// drag & drop from the (non-elevated) Explorer ‒ User Interface Privilege Isolation.
#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // SAFETY: plain Win32 calls on our own process token; the handle is closed below.
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut info = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&mut info as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && info.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

#[cfg(all(test, windows))]
mod elevation_tests {
    #[test]
    fn detects_elevation_consistently_with_the_environment() {
        // `net session` only succeeds with administrator rights
        let admin = std::process::Command::new("net").arg("session").output().map(|o| o.status.success()).unwrap_or(false);
        assert_eq!(super::is_elevated(), admin);
    }
}
