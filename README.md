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

</div>

Mark O Down is not a Markdown editor with a preview pane – the document *is* the preview. You edit
headings, bold text, lists, links, images, tables and badges directly, and the file on disk stays
clean Markdown.

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
- **Emoji & symbol picker** – every Unicode emoji and ~9,700 symbols with English and German names
  and keywords. Search matches inside words (`ross` → 😵 *face with crossed-out eyes*). Skin tones,
  recently used, full 4-byte Unicode support.
- **Images like on GitHub** – relative paths resolve from the document's folder, `/path` from the
  repository root. Drag & drop images and `.md` files into the window.
- **Export** – standalone HTML file, HTML to the clipboard, print.
- Markdown shortcuts while typing (`# `, `- `, `1. `, `> `, `**bold**`, `[text](url)` …).

## Download

Get the installer (`Mark O Down_x.y.z_x64-setup.exe`) from the
[Releases](https://github.com/Harveyhase68/mark_o_down/releases) page. It needs Microsoft Edge
WebView2, which is part of Windows 10/11 (the installer fetches it if missing).

> **Drag & drop not working?** Windows blocks drag & drop from Explorer into programs running
> *as administrator*. Start Mark O Down normally – the status bar warns you if it runs elevated.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Open / Save / Save as | `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| Close document / Print | `Ctrl+W` / `Ctrl+P` |
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
npm run release:version 0.2.0   # sets the version in package.json, Cargo.toml, tauri.conf.json …
git commit -am "Release v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

The workflow checks that the tag matches the version, runs the tests, builds the installer and
creates a **draft** release with the setup attached – review it on GitHub and click *Publish*.
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

## License

[MIT](LICENSE) © 2026 [Alexander Predl](https://predl.cc) · [Impressum](https://predl.cc/impressum/)
