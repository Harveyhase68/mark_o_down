<div align="center">

<img src="app-icon.svg" alt="Mark O Down" width="96" height="96">

# Mark O Down

**A minimal WYSIWYG Markdown editor for Windows – edit `.md` files visually, save them byte-for-byte.**

[![CI](https://github.com/Harveyhase68/mark_o_down/actions/workflows/ci.yml/badge.svg)](https://github.com/Harveyhase68/mark_o_down/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Harveyhase68/mark_o_down?include_prereleases)](https://github.com/Harveyhase68/mark_o_down/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)
[![Built with Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)

**Version 0.3.0** · [Download](https://github.com/Harveyhase68/mark_o_down/releases/latest) · [What's new](#whats-new-in-030) · [Changelog](#changelog)

</div>

Mark O Down is not a Markdown editor with a preview pane – the document *is* the preview. You edit
headings, bold text, lists, links, images, tables and badges directly, and the file on disk stays
clean Markdown.

## What's new in 0.3.0

- 🌍 **Five languages** – German, English, French, Spanish and Italian. Follows the Windows
  language, switchable any time under *Help → Language* – no restart needed.
- 📋 **Paste images and links** – `Ctrl+V` of a screenshot saves it next to the document
  (`images/`) and inserts it; a pasted URL becomes a link, an image URL an image.
- 😀 **Emoji search in your language** – `rire`, `risa`, `ridere` or `lachen` all find 😂.
- The installer speaks all five languages – see the [changelog](#changelog).

## Features

- **True WYSIWYG** for CommonMark + GitHub Flavored Markdown: headings, bold/italic/strikethrough,
  inline code, code blocks, bullet/numbered/task lists, quotes, links, images, horizontal rules, tables.
- **Lossless round-trip** – open → save without edits is byte-identical. When you edit, only the
  changed blocks are rewritten, in their original style (`*` vs `-` bullets, `__bold__` vs `**bold**`,
  `~~~` vs ```` ``` ```` fences, compact `|---|` vs aligned tables …). BOM and CRLF/LF line endings are kept.
- **Everything else is preserved** – HTML, footnotes, front matter and other constructs the editor
  doesn't edit visually are kept verbatim and shown as editable raw blocks.
- **README-friendly HTML** – `<div align="center">`, `<br>` and `<img width="…">` / `<a><img></a>`
  logos are rendered and editable.
- **Badge & icon picker** – [shields.io](https://shields.io), [badgen.net](https://badgen.net),
  [forthebadge.com](https://forthebadge.com), all [Simple Icons](https://simpleicons.org), your own images.
  Sources and templates are configurable (`badges.json`), icon lists are cached for offline use.
- **Emoji & symbol picker** – every Unicode emoji and ~9,700 symbols with names and keywords in
  English plus the UI language. Search matches inside words (`ross` → 😵 *face with crossed-out eyes*). Skin tones,
  recently used, full 4-byte Unicode support.
- **Images like on GitHub** – relative paths resolve from the document's folder, `/path` from the
  repository root. Drag & drop images and `.md` files into the window.
- **Find & replace** with match case, whole word and regular expressions (`$1` groups).
- **Safe** – changes by other programs are detected (reload or ask, never overwritten silently),
  unsaved work is recovered after a crash, recently opened files in the Open menu.
- **Open HTML** – converted to Markdown; a dialog lists exactly what Markdown can't keep.
- **Export** – standalone HTML file, HTML to the clipboard, print. Document zoom 50–300 %.
- **Paste images and links** – `Ctrl+V` of a screenshot saves it next to the document (`images/`)
  and inserts it; a pasted URL becomes a link, an image URL an image.
- **Five languages** – German, English, French, Spanish and Italian; follows the Windows language,
  switchable any time under *Help → Language*.
- Markdown shortcuts while typing (`# `, `- `, `1. `, `> `, `**bold**`, `[text](url)` …).

## Download

Get the installer **`Mark.O.Down_0.3.0_x64-setup.exe`** from the
[latest release](https://github.com/Harveyhase68/mark_o_down/releases/latest) (Windows 10/11, 64-bit).
It needs Microsoft Edge WebView2, which is part of Windows 10/11 (the installer fetches it if missing).

> **"Windows protected your PC"?** The installer is not code-signed yet. Click **More info → Run anyway**.

> **Drag & drop not working?** Windows blocks drag & drop from Explorer into programs running
> *as administrator*. Start Mark O Down normally – the status bar warns you if it runs elevated.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Open / Save / Save as | `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| Close document / Print | `Ctrl+W` / `Ctrl+P` |
| Find / Find & replace / next / previous | `Ctrl+F` / `Ctrl+H` / `F3` / `Shift+F3` |
| Zoom in / out / reset | `Ctrl+Mouse wheel`, `Ctrl+Plus` / `Ctrl+Minus` / `Ctrl+0` |
| Export HTML | `Ctrl+Shift+E` |
| Bold / Italic / Strikethrough / Code | `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` / `Ctrl+E` |
| Link | `Ctrl+K` |
| Emoji & symbols | `Ctrl+.` |
| Headings / Paragraph | `Ctrl+Alt+1…3` / `Ctrl+Alt+0` |
| Bullet / numbered list / quote | `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+9` |
| Indent / outdent list item, next table cell | `Tab` / `Shift+Tab` |
| Line break | `Shift+Enter` |
| Show exported Markdown | `Ctrl+Shift+M` |
| Help | `F1` |

## Building from source

Requirements: [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 22+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for Windows.

```bash
npm install
npm run tauri dev      # run in development mode
npm run tauri build    # release build + installer in src-tauri/target/release/bundle/nsis/
npm test               # round-trip, editor and search tests
npm run unicode        # refresh the emoji/symbol data from unicode.org and CLDR
```

## Releasing

Releases are built by GitHub Actions ([`release.yml`](.github/workflows/release.yml)) when a version tag is pushed:

```bash
npm run release:version 0.3.0   # sets the version in package.json, Cargo.toml, tauri.conf.json …
# add a "### 0.3.0 – <date>" section to the changelog in this README
git commit -am "Release v0.3.0"
git tag v0.3.0
git push origin main v0.3.0
```

The workflow checks that the tag matches the version, runs the tests, builds the installer and
creates a **draft** release with the setup attached. The release notes are taken from the matching
section of the [changelog](#changelog) below – review the draft on GitHub and click *Publish*.
Tags with a suffix (`v0.2.0-beta.1`) become pre-releases. Every push and pull request runs the
test suite ([`ci.yml`](.github/workflows/ci.yml)).

## How it works

```
.md text ──micromark──▶ mdast (syntax tree) ──▶ ProseMirror document  (editing)
.md text ◀─to-markdown── mdast ◀──────────────── ProseMirror document  (saving)
```

- **Parsing/serializing:** [remark](https://github.com/remarkjs/remark) (micromark, mdast, GFM) –
  100 % CommonMark compliant.
- **Editor:** [ProseMirror](https://prosemirror.net) with a schema that contains exactly the Markdown
  constructs, plus [prosemirror-tables](https://github.com/ProseMirror/prosemirror-tables).
- **Round-trip:** every top-level block (and every item of a top-level list) remembers its original
  source and its canonical serialization at load time. On save, an unchanged block is written back
  from the original bytes; only edited blocks are re-serialized.
- **Desktop shell:** [Tauri 2](https://tauri.app) (Rust) – file I/O with strict UTF-8, BOM and line
  ending handling, atomic saves, config and download cache.

The test suite round-trips its fixtures and all README files in `node_modules` byte-for-byte and
checks that full re-serialization renders identical HTML.

## Changelog

### 0.3.0 – 2026-09-28

**New**

- **Paste images and links** (`Ctrl+V`): a copied image (screenshot, image from a browser …) is
  saved as an image file in an `images` folder next to the document and inserted with a relative
  path – an unsaved document is saved first. A pasted URL turns the selected text into a link (or is
  inserted as a link), a URL pointing to an image becomes an image.
- **User interface in five languages**: German, English, French, Spanish and Italian. The language
  follows Windows and can be changed under *Help → Language* without restarting. Everything is
  translated – toolbar, menus, dialogs, find bar, status bar, keyboard shortcut names
  (`Strg`/`Ctrl`/`Maj` …), the HTML import report, badge templates and file dialogs.
- **Emoji search in your language**: names and keywords from CLDR for all five languages
  (English always included), e.g. `rire`, `risa` or `ridere` find 😂.

**Changed**

- `badges.json` is only created when you save your own sources; until then the built-in templates
  follow the UI language. A file that still contains the unchanged defaults of an older version is
  treated the same way.
- The installer is available in English, German, French, Spanish and Italian.

### 0.2.0 – 2026-09-28

**New**

- **Find & replace** (`Ctrl+F` / `Ctrl+H`, `F3` / `Shift+F3`): all matches highlighted with a
  counter, options *match case*, *whole word* (also for umlauts) and *regular expression* with
  `$1` … in the replacement. Finds text inside formatting, lists, tables and code; *Replace*
  keeps the formatting, *Replace all* is a single undo step.
- **Open HTML files** (`.html` / `.htm`, also by drag & drop): converted to Markdown. Before
  importing, a dialog lists exactly what gets lost in this file (scripts, stylesheets, `style` /
  `class` attributes, `<span>`, `<u>` …). `<div align="center">`, `<br>` and `<img>` with size are
  kept, iframes become links. The result is a new document – the HTML file is never overwritten,
  *Save* proposes `<name>.md` next to it.
- **Recently opened files**: the Open button has a menu with the last 10 files; missing files are
  reported and removed from the list.
- **Zoom** 50–300 %: `Ctrl+Mouse wheel` (also touchpad pinch), `Ctrl+Plus` / `Ctrl+Minus` /
  `Ctrl+0` and a *− 100 % +* control in the status bar. Only the document is scaled; the level is
  remembered.
- Search button in the toolbar.

**Data safety**

- **Changes by other programs are detected** (checked before every save and when the window gets
  focus): an unchanged document reloads silently, an edited one asks *Reload* / *Keep mine*.
  Saving never overwrites such changes without asking (*Overwrite* / *Save as…* / *Cancel*).
  A deleted file is reported; *Save* creates it again.
- **Crash recovery**: while there are unsaved changes, a copy is kept in the app data folder
  (never in the document itself). After a crash, power loss or forced restart, the next start offers
  to restore them.
- Text typed while a save is in progress is no longer marked as saved (closing the window would
  not have asked for it).
- Saving through a symbolic link updates the target and keeps the link.

**Fixed**

- Dialogs no longer let the keyboard focus escape: with a dialog open, `Tab` could move into the
  editor behind it and text went blindly into the document. All dialogs now share one frame with a
  locked background, consistent `Esc`, click-outside and focus return.
- `Enter` in the emoji and About dialogs acted even when another button (e.g. *Cancel*) was focused.
- The emoji grid was ~1,900 `Tab` stops; it is now one stop with arrow-key navigation.
- Images whose file names contain `#`, `?` or `%` were not displayed.
- Downloading the icon list had no timeout and could hang forever when offline.
- At the default window width the toolbar wrapped into two rows.

**Security**

- Printing renders the document in a sandbox: scripts inside an untrusted `.md` file can't run.

**Performance**

- Saving after an edit only serializes the changed blocks: 262 ms → 2 ms for a 1 MB document;
  list items no longer rebuild the whole list.

### 0.1.0 – 2026-09-28

First release.

- WYSIWYG editing of CommonMark + GitHub Flavored Markdown with lossless, byte-identical round-trip
  (BOM and CRLF/LF preserved, unchanged blocks written back from the original bytes).
- README-friendly HTML: `<div align="center">`, `<br>`, `<img width>` and `<a><img></a>`.
- Tables with toolbar (rows, columns, alignment), task lists, code blocks, raw HTML blocks.
- Badge & icon picker (shields.io, badgen.net, forthebadge.com, Simple Icons, own images) with
  configurable sources and offline cache.
- Emoji & symbol picker (Unicode 18, CLDR 48) with English and German search.
- Images like on GitHub (relative paths, `/path` from the repository root), drag & drop.
- HTML export, copy HTML, print, close document, Help and About.
- Windows installer (NSIS), `.md` file association.

## License

[MIT](LICENSE) © 2026 [Alexander Predl](https://predl.cc) · [Impressum](https://predl.cc/impressum/)
