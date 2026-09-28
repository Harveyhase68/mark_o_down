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
