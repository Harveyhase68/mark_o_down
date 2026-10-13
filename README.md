<div align="center">

<img src="app-icon.svg" alt="Mark O Down" width="96" height="96">

# Mark O Down

**A minimal WYSIWYG Markdown editor for Windows, macOS and Linux – edit `.md` files visually, save them byte-for-byte.**

[![CI](https://github.com/Harveyhase68/mark_o_down/actions/workflows/ci.yml/badge.svg)](https://github.com/Harveyhase68/mark_o_down/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Harveyhase68/mark_o_down?include_prereleases)](https://github.com/Harveyhase68/mark_o_down/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform: Windows | macOS | Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6)
[![Built with Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)

**Version 0.7.0** · [Download](https://github.com/Harveyhase68/mark_o_down/releases/latest) · [What's new](#whats-new-in-070) · [Changelog](#changelog)

</div>

Mark O Down is not a Markdown editor with a preview pane – the document *is* the preview. You edit
headings, bold text, lists, links, images, tables and badges directly, and the file on disk stays
clean Markdown.

## What's new in 0.7.0

- 🗂️ **Workspaces and a folder tree** – a `.modw` file for a folder of documents, the tree beside
  the editor (left or right, search, paste a path), favourites in *Open workspace …*.
- 📑 **Tabs** – every document in its own tab with its own undo history; the session keeps them all.
- 🔗 **Linked documents** – `[[wiki links]]` like Obsidian (found by name in the workspace),
  `Ctrl+click` follows any link, `Alt+←` goes back; drag a file from the tree into the text → a link.
- 📖 **`[[toc]]`** – a table of contents of the whole workspace (or the document), also in HTML and PDF.
- ✏️ **Split editor** – the Markdown source beside the document can be edited, with an HTML check.
- 📄 **Save as PDF** and **spell checking** with the system's own checker.
- New in 0.6.0: Mermaid diagrams and the extended syntax – see the [changelog](#changelog).

## Features

- **True WYSIWYG** for CommonMark + GitHub Flavored Markdown: headings, bold/italic/strikethrough,
  inline code, code blocks, bullet/numbered/task lists, quotes, links, images, horizontal rules, tables,
  footnotes – plus superscript, subscript and highlight as the HTML tags GitHub renders
  (`<sup>`, `<sub>`, `<mark>`).
- **Folder tree** (`Ctrl+Shift+B`) beside the editor – on the left or right, width by dragging its
  edge, can be hidden; the last folder is remembered. The field on top finds files and folders
  below the current folder by part of their name (`liz` → `Lizenz.md`, `Blizzard.md`); a pasted
  path (file or folder, also with quotes from *Copy as path*) goes straight there. Arrow keys,
  `Enter`, type the first letters to jump, double-click a folder to show only it, `Backspace` /
  ↑ for the parent folder, a small drive selector on Windows.
  **Drag a file from the tree into the document** to link it where you drop it: `[[kapitel1]]`,
  `[[teil 2/Kapitel 2]]` (relative to the document) – or `[Kapitel 2](teil%202/Kapitel%202.md)`
  without wiki links.
- **Workspaces** (`.modw`) for a folder of Markdown documents: *Open → New workspace …* saves
  `<Name>.modw` in the folder (JSON: `version`, `name`, `root` – the documents' folder relative
  to the file, `../` allowed – and `wikiLinks`). Opening one (also by double-click in Explorer)
  shows its folder in the tree and finds `[[Link]]` by name anywhere in it, like Obsidian.
  *Open → Open workspace …* lists every workspace Mark O Down has seen, favourites on top,
  each list sortable by name or last opened. The last workspace is opened again at start.
- **Table of contents** `[[toc]]` (or `[[toc depth=2]]`) on a line of its own: in a workspace it
  lists all its documents folder by folder with their headings, otherwise the document's own
  headings. Generated, never saved (only the marker is); in the HTML / PDF export and print too.
- **Mermaid diagrams** like on GitHub: ` ```mermaid ` blocks are drawn (flowcharts, sequence,
  class, state, Gantt, pie … diagrams); click a diagram to edit its source below it. Also in the
  HTML export and print. Mermaid is loaded only when a document has a diagram.
- **Extended syntax** (Pandoc / Typora / Obsidian, switchable under *Help*, on by default):
  `^superscript^`, `~subscript~`, `==highlight==` and definition lists (`Term` / `: Definition`).
  **Wiki links** like Obsidian: `[[Link]]`, `[[Link|Text]]`, `[[Link#Heading]]`, `[[#Heading]]`,
  `[[sub/Link]]`, `[[../sub/Link]]` (`.md` may be left out).
  GitHub shows these as plain text; switched off, Mark O Down reads Markdown exactly like GitHub
  (then `~text~` is strikethrough).
- **Math** like on GitHub: `$E=mc^2$` inline, `$$ … $$` and ` ```math ` blocks, shown as formulas
  (LaTeX via [Temml](https://temml.org), rendered as MathML – no math fonts to ship). Prices stay
  text: `from $5 to $10` is not a formula (Pandoc's rule). Loaded only when a document has math.
- **Syntax highlighting** in fenced code blocks (` ```js `, ` ```rust ` …, ~40 languages), in GitHub's
  colours – also in the HTML export and when printing. Loaded only when a document has code.
- **Lossless round-trip** – open → save without edits is byte-identical. When you edit, only the
  changed blocks are rewritten, in their original style (`*` vs `-` bullets, `__bold__` vs `**bold**`,
  `~~~` vs ```` ``` ```` fences, compact `|---|` vs aligned tables …). BOM and CRLF/LF line endings are kept.
- **Everything else is preserved** – other HTML, front matter and constructs the editor
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
- **Spell checking** in the language of the text (chosen separately from the interface language),
  using the system's dictionaries.
- **Find & replace** with match case, whole word and regular expressions (`$1` groups).
- **Safe** – changes by other programs are detected (reload or ask, never overwritten silently),
  unsaved work is recovered after a crash, recently opened files in the Open menu.
- **Tabs** – every document in its own tab, each with its own undo history and position;
  drag to reorder, middle-click or × to close, right-click for *Close others / to the right /
  all*, *Copy path*, *Show in file tree*. A file that is open already just comes to the front.
- **Sessions like Notepad++** – closing the app keeps all tabs as they are, unsaved changes
  included, and the next start continues with them. The files are only changed when you save.
- **Open HTML** – converted to Markdown; a dialog lists exactly what Markdown can't keep.
- **Export** – standalone HTML file, PDF, HTML to the clipboard, print. Document zoom 50–300 %.
- **Paste images and links** – `Ctrl+V` of a screenshot saves it next to the document (`images/`)
  and inserts it; a pasted URL becomes a link, an image URL an image.
- **Five languages** – German, English, French, Spanish and Italian; follows the system language,
  switchable any time under *Help → Language*.
- Markdown shortcuts while typing (`# `, `- `, `1. `, `> `, `**bold**`, `[text](url)` …).

## Download

Get the right file from the [latest release](https://github.com/Harveyhase68/mark_o_down/releases/latest):

| System | File |
|---|---|
| Windows 10/11, 64-bit | `Mark.O.Down_<version>_x64-setup.exe` |
| macOS 10.15+ (Apple Silicon and Intel) | `Mark.O.Down_<version>_universal.dmg` |
| Linux, 64-bit – any distribution | `Mark.O.Down_<version>_amd64.AppImage` |
| Debian, Ubuntu, Mint … | `Mark.O.Down_<version>_amd64.deb` |
| Fedora, openSUSE … | `Mark.O.Down-<version>-1.x86_64.rpm` |

The apps are not code-signed yet:

- **Windows:** *"Windows protected your PC"* → click **More info → Run anyway**. The installer asks
  whether to install for you only (the default, no administrator rights) or for all users
  (`C:\Program Files`; unattended: `/S /ALLUSERS`), and which file types (`.md`, `.markdown`,
  `.mdown`, `.mkd`, `.mkdn`, `.mdwn`) Mark O Down should open – all, none or single ones. The app needs Microsoft Edge WebView2, which is part of Windows 10/11
  (the installer fetches it if missing).
- **macOS:** the first time, right-click the app → **Open** (or *System Settings → Privacy & Security →
  Open Anyway*). If macOS says the app *"is damaged"*, run
  `xattr -dr com.apple.quarantine "/Applications/Mark O Down.app"` in Terminal.
- **Linux:** make the AppImage executable (`chmod +x Mark.O.Down_*.AppImage`) and start it, or install
  the `.deb` / `.rpm`, which also registers Mark O Down for `.md` files.

> **Drag & drop not working on Windows?** Windows blocks drag & drop from Explorer into programs
> running *as administrator*. Start Mark O Down normally – the status bar warns you if it runs elevated.

## Keyboard shortcuts

On macOS use `⌘ Cmd` instead of `Ctrl` and `⌥ Option` instead of `Alt` – the tooltips show the
right keys for your system.

| Action | Keys |
|---|---|
| Open / Save / Save as | `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| New tab / Close tab / Print | `Ctrl+N` or `Ctrl+T` / `Ctrl+W` / `Ctrl+P` |
| Next / previous tab / reopen closed tab | `Ctrl+Tab` or `Ctrl+PgDn` / `Ctrl+Shift+Tab` or `Ctrl+PgUp` / `Ctrl+Shift+T` |
| Folder tree on / off | `Ctrl+Shift+B` |
| Find / Find & replace / next / previous | `Ctrl+F` / `Ctrl+H` / `F3` / `Shift+F3` |
| Zoom in / out / reset | `Ctrl+Mouse wheel`, `Ctrl+Plus` / `Ctrl+Minus` / `Ctrl+0` |
| Export HTML | `Ctrl+Shift+E` |
| Bold / Italic / Strikethrough / Code | `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` / `Ctrl+E` |
| Link | `Ctrl+K` |
| Emoji & symbols | `Ctrl+.` |
| Follow a link / back / forward | `Ctrl+click` / `Alt+←` / `Alt+→` |
| Footnote | `Ctrl+Alt+F` (double-click a footnote number: go to the note) |
| Formula block | type `$$` + space in an empty line |
| Headings / Paragraph | `Ctrl+Alt+1…3` / `Ctrl+Alt+0` |
| Bullet / numbered list / quote | `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+9` |
| Indent / outdent list item, next table cell | `Tab` / `Shift+Tab` |
| Line break | `Shift+Enter` |
| Show exported Markdown | `Ctrl+Shift+M` |
| Quit (macOS, asks about unsaved changes) | `⌘Q` |
| Help | `F1` |

## Building from source

Requirements: [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 22+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system (on Linux:
`libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf` …).

```bash
npm install
npm run tauri dev      # run in development mode
npm run tauri build    # release build + installer/packages in src-tauri/target/release/bundle/
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

The workflow checks that the tag matches the version, runs the tests, creates a **draft** release
and builds the Windows installer, the macOS app and the Linux packages into it. The release notes are taken from the matching
section of the [changelog](#changelog) below – review the draft on GitHub and click *Publish*.
Tags with a suffix (`v0.2.0-beta.1`) become pre-releases. Every push and pull request runs the
test suite on Windows, macOS and Linux ([`ci.yml`](.github/workflows/ci.yml)).

## How it works

```
.md text ──micromark──▶ mdast (syntax tree) ──▶ ProseMirror document  (editing)
.md text ◀─to-markdown── mdast ◀──────────────── ProseMirror document  (saving)
```

- **Parsing/serializing:** [remark](https://github.com/remarkjs/remark) (micromark, mdast, GFM) –
  100 % CommonMark compliant.
- **Editor:** [ProseMirror](https://prosemirror.net) with a schema that contains exactly the Markdown
  constructs, plus [prosemirror-tables](https://github.com/ProseMirror/prosemirror-tables);
  code colouring by [highlight.js](https://highlightjs.org) (BSD-3-Clause) and formulas by
  [Temml](https://temml.org) (MIT), both loaded on demand.
- **Round-trip:** every top-level block (and every item of a top-level list) remembers its original
  source and its canonical serialization at load time. On save, an unchanged block is written back
  from the original bytes; only edited blocks are re-serialized.
- **Desktop shell:** [Tauri 2](https://tauri.app) (Rust) – file I/O with strict UTF-8, BOM and line
  ending handling, atomic saves, config and download cache.

The test suite round-trips its fixtures and all README files in `node_modules` byte-for-byte and
checks that full re-serialization renders identical HTML.

## Changelog

### 0.7.0 – 2026-10-13

**New**

- **Split editor**: the Markdown source next to the visual editor (`Ctrl+Shift+M`) can now be
  edited too. Whichever side you type in leads: while source changes are not applied yet the
  visual editor is dimmed, after a short pause – or as soon as you click elsewhere – they are
  applied (only the blocks that changed). `Ctrl+Z` works per side.
- **Following links** (`Ctrl+click`): `[Text](#heading)` jumps to the heading (anchors as on
  GitHub, also in the HTML export), `[Text](other.md#heading)` opens the file in Mark O Down and
  jumps there, `/…` paths start at the repository root; `Alt+←` / `Alt+→` (or the mouse's side
  buttons) go back and forth. Web links open in the browser; other local files are only shown in
  Explorer – a link never starts a program.
- **Spell checking** with the operating system's own checker (Windows spell checker, macOS
  spelling, Hunspell dictionaries on Linux): misspelled words are underlined in red; right-click
  for suggestions, *Add to dictionary* and *Ignore*. The **language of the texts** is chosen under
  *Help* independently of the interface language (e.g. German menus, English README) and saved;
  so is switching it off. Code, formulas, diagrams, raw HTML, links, paths, file names, CamelCase
  and ALLCAPS words are not checked. Languages are those installed in the system – on Linux
  e.g. the package `hunspell-de-de`.
- **Save as PDF…** (in the Save menu): the page of the HTML export – code colours, formulas,
  diagrams, images – as an A4 PDF with real, selectable text and working links. On Windows it is
  created directly by the built-in web engine (no print dialog); on macOS and Linux the print
  dialog opens, which saves PDFs too.
- **HTML check** under the source: tags that are not closed, closing tags without an opening one
  and comments without `-->` (which would hide the rest of the document) are listed with their
  line – click to jump there, *Close* / *Remove* fixes it (undoable with `Ctrl+Z`).
- **Table of contents** `[[toc]]` / `[[toc depth=N]]` (extended syntax or wiki links), alone on
  a line: in a workspace all its documents (except the one it is in) like the folder tree – in
  each folder README/index first, then the documents in natural order, then the subfolders –
  each with its first `#` heading as title and its headings below it down to level N (default
  3); without a workspace the document's own headings. Only the marker is saved; the table is
  drawn in the editor (a click on an entry goes there, double-click changes the depth), kept up
  to date while you type (open tabs count with their unsaved text) and rendered into the HTML
  export, the PDF and the printout with links relative to the document.
- **Tabs**: every opened document gets its own tab (a new, untouched empty tab is used for the
  next file instead). Each tab keeps its undo history, cursor and scroll position; opening a
  file that is open already brings its tab to the front, and so does following a link to it.
  Two tabs with the same name show their folder. `Ctrl+N` / `Ctrl+T` new tab, `Ctrl+W` close
  (asks about unsaved changes), `Ctrl+Tab` / `Ctrl+Shift+Tab` (or `Ctrl+PgDn` / `Ctrl+PgUp`)
  switch, `Ctrl+Shift+T` reopens the tab closed last; middle-click closes, drag reorders,
  right-click: close others / to the right / all, copy path, show in Explorer or the file tree.
  Several files dropped from Explorer open in tabs. The **session** keeps all tabs (unsaved
  changes included, the one in front stays in front); crash recovery covers all tabs too, and
  recovery copies of earlier versions are still read.
- **Drag a file from the folder tree into the document**: a link to it is inserted where it is
  dropped (a line shows where) – `[[kapitel1]]`, `[[teil 2/Kapitel 2]]` relative to the document,
  or a normal Markdown link `[Kapitel 2](teil%202/Kapitel%202.md)` without wiki links. A space is
  added where the link would stick to a word. The file is neither opened nor copied in.
- **Workspaces** (`.modw`): a file in the documents' folder with its name, the documents' folder
  (`root`, relative – `../docs` works too), whether `[[wiki links]]` are used (independent of the
  extended syntax) and a `version`. *Open → New workspace …* (or *New workspace here …* in the
  folder tree) creates one, *Open workspace …* shows all workspaces ever opened – favourites on
  top (*Link* / ✕), both lists sortable by name or date (click again: reversed), missing files
  marked and removable. In a workspace `[[Link]]` is also found by name in any subfolder (the
  nearest wins), the window title and the tree show its name, *Workspace settings …* changes it.
  The installer can associate `.modw` with Mark O Down.
- **Folder tree** (`Ctrl+Shift+B`): folders and Markdown files beside the editor, left or right,
  resizable, can be hidden – the last folder is remembered. Search by part of a name (only in the
  current folder and below, not the whole disk), paste a path to go there, keyboard navigation
  with type-ahead, double-click a folder to make it the top, drive selector on Windows. Files
  that appear or disappear outside are picked up when the window is activated.
- **Wiki links** (extended syntax): `[[Link]]`, `[[Link|Text]]`, `[[Link#Heading]]`,
  `[[#Heading]]` (in this document), `[[sub/Link]]`, `[[../sub/Link]]` – resolved from the
  document's folder, `.md` may be left out. Typing the closing `]]` creates the link, double-click
  edits target and text, `Ctrl+click` follows it (also `Alt+←` back). Targets that don't exist are
  underlined in dashed red. Saved exactly as written; in the HTML export they are normal links.

**Fixed**

- **Missing cursor** (reported by a user): in an empty or short document only the first line
  could be clicked – a click anywhere else on the page (e.g. after maximizing the window) left
  the editor without a cursor. Now the whole page is editable, a click on its margin puts the
  cursor at the nearest place, the cursor is in the document right after opening (also by
  double-click; the window was still hidden when it tried), and the editor keeps the focus when
  the window is maximized, restored or activated again.
- Numbered lists with gaps (`1. 2. 3. 5.`): typing a number below the list continues it (it used
  to start a second list unless the number matched the item count), and a new item gets the
  number after the one before it.

**Installer (Windows)**

- **"Just for me" is the default** for a new installation (no administrator rights, installed to
  `%LOCALAPPDATA%\Programs`); *for all users* (`C:\Program Files`) is one click away. An update
  keeps the way it was installed.
- **Choose the file types**: a new page lists `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn` and
  `.mdwn` – tick all, none or single ones. The choice is remembered for updates; a type you untick
  later is given back to the program that had it before.
- Safer file associations (also when uninstalling): only what is still Mark O Down's is undone –
  a type another program (e.g. VS Code) has taken over in the meantime is left alone, and
  unticking one type no longer affects the others.

### 0.6.0 – 2026-10-01

**New**

- **Mermaid diagrams**: ` ```mermaid ` blocks are drawn as diagrams, like on GitHub. Click a diagram
  to edit its source right below it – the diagram follows while you type; errors are shown under
  the last good version. *Diagram* in the toolbar inserts an example; ` ```mermaid ` + space starts
  one. Also in the HTML export and print (as SVG). Mermaid 11 is loaded only when a document has a
  diagram; the installer grows by about 1 MB.
- **Extended syntax** (switchable under *Help → Extended syntax*, on by default):
  `^superscript^`, `~subscript~` (no spaces inside, as in Pandoc), `==highlight==` and definition
  lists (`Term` followed by `: Definition`). Typing `: ` at the start of a line below a paragraph
  makes it a definition list; `Enter` in a term jumps to its definition, on an empty last line of
  a definition starts the next term, in an empty term leaves the list. The toolbar buttons for
  superscript/subscript/highlight write `^x^` / `~x~` / `==x==` (with spaces inside: the HTML tag).
  GitHub does not know this syntax and shows it as text – switched off, Mark O Down reads exactly
  like GitHub again (`~text~` is strikethrough there). Switching re-reads the open document.

**Fixed**

- When edited blocks were saved again: an HTML link closed with `</A>` became `</a>`,
  `<sup>*x*</sup>` became `*<sup>x</sup>*`, and two adjacent links to the same address
  (`[a](x)[b](x)`) were merged into one – all now stay as written.

### 0.5.0 – 2026-09-30

**New**

- **Sessions like Notepad++**: closing the app (✕, `Alt+F4`, `⌘Q`) no longer asks to save – the
  document, unsaved changes included, is kept as a copy in the app data folder and the next start
  continues with it (still marked unsaved, same cursor and scroll position); a saved file is simply
  reopened. The file itself is only changed when you save. Closing the *document* (`Ctrl+W`) or
  opening another file still asks. If the app is started with a file, or several windows were
  closed with unsaved changes, the other unsaved states are offered instead of being lost.
  *Help → Remember session on exit* switches it off (then closing asks as before).
- **Footnotes** (`[^1]`) are shown and edited like on GitHub: the reference shows the number GitHub
  would show (by order of first reference, whatever the label), its note as tooltip; double-click
  jumps to the note. *Insert footnote* (`Ctrl+Alt+F`) adds the next number and its note at the end.
- **Superscript, subscript and highlight** – `<sup>`, `<sub>`, `<mark>` are shown as formatting and
  have toolbar buttons. They are written as these HTML tags because that is what GitHub renders
  (`2^3^` / `H~2~O` / `==x==` are not GitHub Markdown). Tags with attributes are kept as they are;
  importing HTML keeps them too.
- **Syntax highlighting** of fenced code blocks with a language (~40 languages via highlight.js,
  GitHub colours, light and dark) – in the editor, the HTML export and print. The highlighter is
  loaded only when needed; the installer grows by about 50 KB.
- **Math**: `$…$` inline and `$$…$$` / ` ```math ` blocks are shown as formulas (Temml, MathML) –
  also in the HTML export, *Copy HTML* and print. Click a formula block to edit its LaTeX below it;
  double-click an inline formula for a dialog with live preview. *Formula* in the toolbar: in an
  empty paragraph a block, with text selected that text as formula, otherwise the dialog; typing
  `$$` + space starts a block. Single `$` follow Pandoc's rule, so prices like `$5 to $10` stay
  text, and `$` is escaped when saving only where a formula could otherwise form. The formula
  renderer is loaded only when needed; the installer grows by about 60 KB.
- **Third-party licenses** under *Help → About → Open Source*: the licenses of all components
  the app is built with (npm packages, Rust crates, Unicode data), generated at build time
  (`npm run licenses`), loaded only when opened.
- More Markdown file extensions: `.mdown`, `.mkd`, `.mkdn`, `.mdwn` open directly and are
  registered by the installers (with `.md` and `.markdown`).

### 0.4.0 – 2026-09-29

**New**

- **macOS and Linux**: Mark O Down now runs on macOS 10.15+ (one app for Apple Silicon and Intel,
  `.dmg`) and Linux (`.AppImage`, `.deb`, `.rpm`). On macOS the shortcuts use `⌘` and the tooltips
  show `⇧⌘S` style keys, *Quit* (`⌘Q`) asks about unsaved changes, and *Open with…* /
  double-clicking a `.md` file opens it – also while the app is already running. The Linux
  packages register Mark O Down for `.md` files.
- **Center a table on its own**: with the cursor anywhere in a table, *Center* wraps the whole
  table in `<div align="center">` (and removes it again) – no need to select the text around it.

**Fixed**

- Centered tables are also centered in the exported HTML.
- Raw elements (`<kbd>`, `<sup>` …) show their tooltip in the new language right after switching.

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
