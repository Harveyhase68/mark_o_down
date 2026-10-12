//! Spell checking with the operating system's own checker – the language is chosen by
//! the app (independent of the interface language), the menus are the app's own:
//!   • Windows: the Windows spell checker (ISpellChecker – what Office and Edge use);
//!     languages: those installed in Windows
//!   • macOS:   NSSpellChecker
//!   • Linux:   Hunspell dictionaries of the distribution (hunspell-de-de …), read with
//!     `spellbook` (pure Rust, Helix editor; MPL-2.0)
//!
//! The checkers live on one worker thread (COM objects stay in their apartment); the
//! commands send it jobs. The personal dictionary is the frontend's (a file per language).

use std::collections::HashMap;
use std::sync::{Mutex, mpsc};

type Reply<T> = mpsc::Sender<Result<T, String>>;

enum Job {
    Languages(Reply<Vec<String>>),
    Check(String, Vec<String>, Reply<Vec<bool>>),
    Suggest(String, String, Reply<Vec<String>>),
}

/// The language-independent part of a backend.
trait Checker {
    fn languages(&mut self) -> Vec<String>;
    /// `true` per word that is spelled correctly
    fn check(&mut self, lang: &str, words: &[String]) -> Result<Vec<bool>, String>;
    fn suggest(&mut self, lang: &str, word: &str) -> Result<Vec<String>, String>;
}

pub struct SpellService(Mutex<mpsc::Sender<Job>>);

impl Default for SpellService {
    fn default() -> Self {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("spell".into())
            .spawn(move || {
                let mut backend = platform::backend();
                for job in rx {
                    match job {
                        Job::Languages(r) => drop(r.send(Ok(backend.languages()))),
                        Job::Check(lang, words, r) => drop(r.send(backend.check(&lang, &words))),
                        Job::Suggest(lang, word, r) => drop(r.send(backend.suggest(&lang, &word))),
                    }
                }
            })
            .expect("spell thread");
        Self(Mutex::new(tx))
    }
}

impl SpellService {
    async fn ask<T: Send + 'static>(&self, make: impl FnOnce(Reply<T>) -> Job) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        self.0.lock().map_err(|e| e.to_string())?.send(make(tx)).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?)
            .await
            .map_err(|e| e.to_string())?
    }
}

/// Languages there is a dictionary for (BCP 47 tags: `de-DE`, `en-US` …).
#[tauri::command]
pub async fn spell_languages(spell: tauri::State<'_, SpellService>) -> Result<Vec<String>, String> {
    spell.ask(Job::Languages).await
}

/// For each word: is it spelled correctly?
#[tauri::command]
pub async fn spell_check(spell: tauri::State<'_, SpellService>, lang: String, words: Vec<String>) -> Result<Vec<bool>, String> {
    spell.ask(|r| Job::Check(lang, words, r)).await
}

/// Suggestions for a misspelled word, best first.
#[tauri::command]
pub async fn spell_suggest(spell: tauri::State<'_, SpellService>, lang: String, word: String) -> Result<Vec<String>, String> {
    spell.ask(|r| Job::Suggest(lang, word, r)).await
}

const MAX_SUGGESTIONS: usize = 8;

// ------------------------------------------------------------------ Windows

#[cfg(windows)]
mod platform {
    use super::*;
    use windows::Win32::Globalization::{ISpellChecker, ISpellCheckerFactory, ISpellingError, SpellCheckerFactory};
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, IEnumString};
    use windows::core::{HSTRING, PWSTR};

    pub fn backend() -> Box<dyn Checker> {
        // SAFETY: COM on this (the spell worker's) thread, multithreaded apartment
        let factory = unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            CoCreateInstance::<_, ISpellCheckerFactory>(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER).ok()
        };
        Box::new(WindowsChecker { factory, checkers: HashMap::new() })
    }

    struct WindowsChecker {
        factory: Option<ISpellCheckerFactory>,
        checkers: HashMap<String, ISpellChecker>,
    }

    /// All strings of an IEnumString (each freed after copying).
    unsafe fn strings(list: IEnumString) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            let mut item = [PWSTR::null()];
            let mut fetched = 0u32;
            // SAFETY: one slot, the string is ours to free
            let hr = unsafe { list.Next(&mut item, Some(&mut fetched)) };
            if hr.is_err() || fetched == 0 {
                break;
            }
            unsafe {
                out.push(item[0].to_string().unwrap_or_default());
                CoTaskMemFree(Some(item[0].0 as *const _));
            }
        }
        out
    }

    impl WindowsChecker {
        fn checker(&mut self, lang: &str) -> Result<&ISpellChecker, String> {
            if !self.checkers.contains_key(lang) {
                let factory = self.factory.as_ref().ok_or("no spell checker in this Windows")?;
                // SAFETY: plain COM call on the worker thread
                let checker = unsafe { factory.CreateSpellChecker(&HSTRING::from(lang)) }.map_err(|e| e.message().to_string())?;
                self.checkers.insert(lang.to_string(), checker);
            }
            Ok(&self.checkers[lang])
        }
    }

    impl Checker for WindowsChecker {
        fn languages(&mut self) -> Vec<String> {
            let Some(factory) = &self.factory else { return vec![] };
            // SAFETY: plain COM calls on the worker thread
            unsafe { factory.SupportedLanguages().map(|l| strings(l)).unwrap_or_default() }
        }

        fn check(&mut self, lang: &str, words: &[String]) -> Result<Vec<bool>, String> {
            let checker = self.checker(lang)?;
            words
                .iter()
                .map(|w| {
                    // SAFETY: plain COM calls on the worker thread
                    unsafe {
                        let errors = checker.Check(&HSTRING::from(w.as_str())).map_err(|e| e.message().to_string())?;
                        let mut first: Option<ISpellingError> = None;
                        let _ = errors.Next(&mut first);
                        Ok(first.is_none())
                    }
                })
                .collect()
        }

        fn suggest(&mut self, lang: &str, word: &str) -> Result<Vec<String>, String> {
            let checker = self.checker(lang)?;
            // SAFETY: plain COM calls on the worker thread
            let all = unsafe { strings(checker.Suggest(&HSTRING::from(word)).map_err(|e| e.message().to_string())?) };
            Ok(all.into_iter().take(MAX_SUGGESTIONS).collect())
        }
    }
}

// ------------------------------------------------------------------ macOS

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2_app_kit::NSSpellChecker;
    use objc2_foundation::{NSRange, NSString};

    pub fn backend() -> Box<dyn Checker> {
        Box::new(MacChecker)
    }

    struct MacChecker;

    impl Checker for MacChecker {
        fn languages(&mut self) -> Vec<String> {
            let checker = NSSpellChecker::sharedSpellChecker();
            // macOS names them like `de` or `en_GB`: tags with `-`
            checker.availableLanguages().iter().map(|l| l.to_string().replace('_', "-")).collect()
        }

        fn check(&mut self, lang: &str, words: &[String]) -> Result<Vec<bool>, String> {
            let checker = NSSpellChecker::sharedSpellChecker();
            let language = NSString::from_str(&lang.replace('-', "_"));
            Ok(words
                .iter()
                .map(|w| {
                    // SAFETY: no word count wanted (null pointer is allowed)
                    let range = unsafe {
                        checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(
                            &NSString::from_str(w),
                            0,
                            Some(&language),
                            false,
                            0,
                            std::ptr::null_mut(),
                        )
                    };
                    range.length == 0
                })
                .collect())
        }

        fn suggest(&mut self, lang: &str, word: &str) -> Result<Vec<String>, String> {
            let checker = NSSpellChecker::sharedSpellChecker();
            let text = NSString::from_str(word);
            let range = NSRange::new(0, text.length());
            let guesses = checker.guessesForWordRange_inString_language_inSpellDocumentWithTag(
                range,
                &text,
                Some(&NSString::from_str(&lang.replace('-', "_"))),
                0,
            );
            Ok(guesses.map(|g| g.iter().take(MAX_SUGGESTIONS).map(|s| s.to_string()).collect()).unwrap_or_default())
        }
    }
}

// ------------------------------------------------------------------ Linux (Hunspell dictionaries)

#[cfg(any(target_os = "linux", test))]
mod hunspell {
    use super::*;
    use std::path::{Path, PathBuf};

    /// Where distributions put Hunspell dictionaries (`de_DE.aff` + `de_DE.dic`).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))] // tests only use their own folder
    pub const DIRS: &[&str] = &["/usr/share/hunspell", "/usr/share/myspell", "/usr/share/myspell/dicts", "/usr/local/share/hunspell"];

    pub struct HunspellChecker {
        dirs: Vec<PathBuf>,
        dicts: HashMap<String, spellbook::Dictionary>,
    }

    impl HunspellChecker {
        pub fn new(dirs: Vec<PathBuf>) -> Self {
            Self { dirs, dicts: HashMap::new() }
        }

        /// `de-DE` → the folder that has `de_DE.aff` and `.dic`
        fn find(&self, lang: &str) -> Option<(PathBuf, PathBuf)> {
            let stem = lang.replace('-', "_");
            self.dirs.iter().find_map(|d| {
                let aff = d.join(format!("{stem}.aff"));
                let dic = d.join(format!("{stem}.dic"));
                (aff.is_file() && dic.is_file()).then_some((aff, dic))
            })
        }

        fn dict(&mut self, lang: &str) -> Result<&spellbook::Dictionary, String> {
            if !self.dicts.contains_key(lang) {
                let (aff, dic) = self.find(lang).ok_or_else(|| format!("no dictionary for {lang}"))?;
                let dict = spellbook::Dictionary::new(&read_text(&aff)?, &read_text(&dic)?).map_err(|e| e.to_string())?;
                self.dicts.insert(lang.to_string(), dict);
            }
            Ok(&self.dicts[lang])
        }
    }

    /// Dictionaries are UTF-8 or, older ones, ISO-8859-1/-15 (`SET` line in the .aff).
    pub fn read_text(path: &Path) -> Result<String, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(e) => e.into_bytes().iter().map(|&b| b as char).collect(), // Latin-1: one byte = one char
        })
    }

    impl Checker for HunspellChecker {
        fn languages(&mut self) -> Vec<String> {
            let mut out: Vec<String> = self
                .dirs
                .iter()
                .filter_map(|d| std::fs::read_dir(d).ok())
                .flatten()
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let stem = name.strip_suffix(".aff")?;
                    // a language tag, not e.g. "hyph_de_DE"
                    (stem.len() <= 6 && stem.chars().all(|c| c.is_ascii_alphabetic() || c == '_') && self.find(stem).is_some()).then(|| stem.replace('_', "-"))
                })
                .collect();
            out.sort();
            out.dedup();
            out
        }

        fn check(&mut self, lang: &str, words: &[String]) -> Result<Vec<bool>, String> {
            let dict = self.dict(lang)?;
            Ok(words.iter().map(|w| dict.check(w)).collect())
        }

        fn suggest(&mut self, lang: &str, word: &str) -> Result<Vec<String>, String> {
            let dict = self.dict(lang)?;
            let mut out = Vec::new();
            dict.suggest(word, &mut out);
            out.truncate(MAX_SUGGESTIONS);
            Ok(out)
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    pub fn backend() -> Box<dyn Checker> {
        Box::new(hunspell::HunspellChecker::new(hunspell::DIRS.iter().map(std::path::PathBuf::from).collect()))
    }
}

#[cfg(test)]
mod tests {
    use super::Checker;
    use super::hunspell::HunspellChecker;

    /// A tiny Hunspell dictionary: "Haus", "Maus", "Baum", "Häuser"; a Latin-1 .dic too.
    fn dictionary(dir: &std::path::Path) {
        std::fs::write(dir.join("xx_XX.aff"), "SET UTF-8\nTRY aeiouhmsbrä\n").unwrap();
        std::fs::write(dir.join("xx_XX.dic"), "4\nHaus\nMaus\nBaum\nHäuser\n").unwrap();
        std::fs::write(dir.join("yy_YY.aff"), "SET ISO8859-1\n").unwrap();
        std::fs::write(dir.join("yy_YY.dic"), b"1\nH\xe4user\n").unwrap();
        std::fs::write(dir.join("hyph_xx_XX.dic"), "not a dictionary").unwrap();
    }

    #[test]
    fn hunspell_dictionaries_check_and_suggest() {
        let dir = std::env::temp_dir().join(format!("mod_spell_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dictionary(&dir);
        let mut checker = HunspellChecker::new(vec![dir.clone()]);
        assert_eq!(checker.languages(), vec!["xx-XX", "yy-YY"]);
        let words: Vec<String> = ["Haus", "Hasu", "Häuser"].iter().map(|s| s.to_string()).collect();
        assert_eq!(checker.check("xx-XX", &words).unwrap(), vec![true, false, true]);
        assert!(checker.suggest("xx-XX", "Hasu").unwrap().contains(&"Haus".to_string()));
        assert_eq!(checker.check("yy-YY", &["Häuser".to_string()]).unwrap(), vec![true]); // Latin-1 dictionary
        assert!(checker.check("zz-ZZ", &[]).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_spell_checker_answers() {
        let mut checker = super::platform::backend();
        let langs = checker.languages();
        // English is there on every Windows with the spell checker
        let Some(en) = langs.iter().find(|l| l.starts_with("en")).cloned() else { return };
        let words: Vec<String> = ["house", "hosue"].iter().map(|s| s.to_string()).collect();
        assert_eq!(checker.check(&en, &words).unwrap(), vec![true, false]);
        assert!(checker.suggest(&en, "hosue").unwrap().iter().any(|s| s == "house"));
    }
}
