//! Byte-level handling of Markdown files: UTF-8, BOM and line endings.
//!
//! The editor always works with `\n`; the original line ending and BOM are
//! remembered and restored on save, so an unedited file is written back
//! byte-identical.

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

const BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdFile {
    /// Content with `\n` line endings, without BOM.
    pub text: String,
    pub eol: Eol,
    pub bom: bool,
    /// File mixed `\r\n` and `\n`; it will be saved with `eol` throughout.
    pub mixed_eol: bool,
}

pub fn decode(bytes: &[u8]) -> Result<MdFile, String> {
    let (bom, body) = match bytes.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, bytes),
    };
    let raw = std::str::from_utf8(body).map_err(|e| {
        format!(
            "kein gültiges UTF-8 (Byte {}); die Datei wird nicht geöffnet, um sie beim Speichern nicht zu beschädigen",
            e.valid_up_to() + if bom { BOM.len() } else { 0 }
        )
    })?;

    let crlf = raw.matches("\r\n").count();
    let lf = raw.matches('\n').count() - crlf;
    let eol = if crlf > lf { Eol::Crlf } else { Eol::Lf };
    let text = if crlf > 0 { raw.replace("\r\n", "\n") } else { raw.to_owned() };

    Ok(MdFile { text, eol, bom, mixed_eol: crlf > 0 && lf > 0 })
}

pub fn encode(text: &str, eol: Eol, bom: bool) -> Vec<u8> {
    let text = text.replace("\r\n", "\n");
    let text = match eol {
        Eol::Lf => text,
        Eol::Crlf => text.replace('\n', "\r\n"),
    };
    let mut out = Vec::with_capacity(text.len() + 3);
    if bom {
        out.extend_from_slice(BOM);
    }
    out.extend_from_slice(text.as_bytes());
    out
}

/// Fingerprint of a file's bytes (length + FNV-1a 64), to detect changes
/// made outside the editor.
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:x}-{h:016x}", bytes.len())
}

/// Error text the frontend recognizes: the file changed on disk since it was loaded.
pub const EXTERNAL_CHANGE: &str = "EXTERNAL_CHANGE";

/// Why a save was refused or failed.
#[derive(Debug, PartialEq)]
pub enum SaveError {
    /// The file on disk is no longer the one that was loaded (someone else wrote it).
    ExternalChange,
    Io(String),
}

/// Save the document safely:
/// * `expected`: hash of the file as it was loaded/last saved. If the file on
///   disk differs, nothing is written (`ExternalChange`) unless `force`.
///   A missing file is fine (deleted or moved meanwhile – nothing to lose).
/// * Symlinks are followed, so the link stays a link and its target is updated.
///
/// Returns the hash of the written content.
pub fn save_document(path: &Path, bytes: &[u8], expected: Option<&str>, force: bool) -> Result<String, SaveError> {
    let target = std::fs::canonicalize(path).map(crate::paths::strip_verbatim).unwrap_or_else(|_| path.to_path_buf());
    if let (Some(expected), false) = (expected, force) {
        match std::fs::read(&target) {
            Ok(current) if content_hash(&current) != expected => return Err(SaveError::ExternalChange),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(SaveError::Io(e.to_string())),
        }
    }
    write_atomic(&target, bytes).map_err(|e| SaveError::Io(e.to_string()))?;
    Ok(content_hash(bytes))
}

/// Write to a temp file next to the target, then rename over it, so a crash
/// or full disk never leaves a half-written document.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.mark_o_down.tmp"));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(bytes: &[u8]) -> Vec<u8> {
        let f = decode(bytes).unwrap();
        encode(&f.text, f.eol, f.bom)
    }

    #[test]
    fn lf_is_preserved() {
        let src = "# Hi 😂\n\n- a\n".as_bytes();
        assert_eq!(roundtrip(src), src);
        assert_eq!(decode(src).unwrap().eol, Eol::Lf);
    }

    #[test]
    fn crlf_and_bom_are_preserved() {
        let src = b"\xEF\xBB\xBF# Hi\r\n\r\ntext \xF0\x9F\x98\x82\r\n";
        let f = decode(src).unwrap();
        assert!(f.bom);
        assert_eq!(f.eol, Eol::Crlf);
        assert_eq!(f.text, "# Hi\n\ntext 😂\n");
        assert_eq!(roundtrip(src), src);
    }

    #[test]
    fn four_byte_unicode_survives() {
        let src = "👨‍👩‍👧‍👦 🇦🇹 𠜎 𝕏\n";
        assert_eq!(decode(src.as_bytes()).unwrap().text, src);
    }

    #[test]
    fn mixed_line_endings_are_reported() {
        let f = decode(b"a\r\nb\nc\r\n").unwrap();
        assert!(f.mixed_eol);
        assert_eq!(f.eol, Eol::Crlf);
        assert_eq!(f.text, "a\nb\nc\n");
    }

    #[test]
    fn invalid_utf8_is_rejected() {
        assert!(decode(b"ok \xFF\xFE broken").is_err());
    }

    #[test]
    fn atomic_write_replaces_existing() {
        let dir = std::env::temp_dir().join(format!("mark_o_down_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.md");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod save_tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("mod_save_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn saves_when_the_file_is_unchanged() {
        let d = temp_dir("unchanged");
        let p = d.join("a.md");
        std::fs::write(&p, b"one").unwrap();
        let h = content_hash(b"one");
        assert_eq!(save_document(&p, b"two", Some(&h), false), Ok(content_hash(b"two")));
        assert_eq!(std::fs::read(&p).unwrap(), b"two");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_external_changes() {
        let d = temp_dir("conflict");
        let p = d.join("a.md");
        std::fs::write(&p, b"one").unwrap();
        let loaded = content_hash(b"one");
        std::fs::write(&p, b"changed by git pull").unwrap();
        assert_eq!(save_document(&p, b"mine", Some(&loaded), false), Err(SaveError::ExternalChange));
        assert_eq!(std::fs::read(&p).unwrap(), b"changed by git pull", "external content must survive");
        // the user explicitly chose "overwrite"
        assert!(save_document(&p, b"mine", Some(&loaded), true).is_ok());
        assert_eq!(std::fs::read(&p).unwrap(), b"mine");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn recreates_a_deleted_file() {
        let d = temp_dir("deleted");
        let p = d.join("a.md");
        assert!(save_document(&p, b"new", Some(&content_hash(b"old")), false).is_ok());
        assert_eq!(std::fs::read(&p).unwrap(), b"new");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn keeps_symlinks() {
        let d = temp_dir("symlink");
        let target = d.join("real.md");
        let link = d.join("link.md");
        std::fs::write(&target, b"one").unwrap();
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&target, &link);
        // Windows needs developer mode (or admin) to create symlinks: skip otherwise
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(&target, &link);
        if made.is_err() {
            eprintln!("symlink test skipped: cannot create symlinks here");
            return;
        }
        save_document(&link, b"two", None, false).unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&target).unwrap(), b"two");
        std::fs::remove_dir_all(&d).unwrap();
    }
}
