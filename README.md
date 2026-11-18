# Bloom

A desktop canvas for developing YouTube videos: cards, vines, frames and pen marks on an infinite board,
a script view that follows the path you drew, and SQLite that never loses a board.

Tauri v2 (Rust) + rusqlite, plain ES-module HTML/CSS/JS, no bundler, no framework, local fonts only.

## Install

- **Windows:** `Bloom_0.1.0_x64-setup.exe` from the releases page. Per-user NSIS install, no admin rights,
  registers `.bloom` file association.
- **Android:** `app-universal-debug.apk` (arm64). Debug-signed, so Android will warn about an unknown source —
  allow it once. Same SQLite schema as the desktop build.

## Run it

```bash
cd /f/Code/HeThan/GitHub/Bloom
export PATH="$HOME/.cargo/bin:/c/msys64/ucrt64/bin:$PATH"
cargo build --manifest-path src-tauri/Cargo.toml
cd src-tauri/target/debug && ./Bloom.exe
```

- `cargo` is not on PATH here; it lives at `~/.cargo/bin/cargo` (gnu toolchain, no MSVC needed).
- If F: is low on space: `CARGO_TARGET_DIR=D:/bloom-target TMP=TEMP=TMPDIR=D:/bloom-tmp cargo build …`.
- Builds are incremental only for Rust; every `ui/*` edit is embedded at compile time, so a UI change needs
  a `cargo build`. Pure frontend iteration: `cd ui && py -3.13 -m http.server 8765` (no SQLite, localStorage
  mirror only).
- Kill a running copy before rebuilding: `powershell -c "Get-Process Bloom | Stop-Process -Force"`.

## Where the data lives

`%APPDATA%\com.bloom.app\`

| path | what |
|---|---|
| `bloom.db` | boards, cards, vines, frames, strokes, shapes, snapshots, settings (schema v3, WAL) |
| `bloom.db.bak-v2` | copy taken before the v2 → v3 migration |
| `attachments/` | image files, named by sha256 (deduped) — the only folder the asset protocol can read |
| `backups/` | `VACUUM INTO` copies, one per day, last seven kept |

## What it does

**Canvas** — cards (idea, hook, script, shot, titles, thumbnail, sticky, image, source), vines with an
optional script path, frames with handles, pen strokes and outline shapes. Pan, cursor-anchored zoom
0.2–2.5, fit, snap to grid, alignment guides, z-order, multi-select with box/Shift/Ctrl, resize, duplicate,
copy/paste with structure, undo/redo (200 entity patches).

**Script view** — walks the script-path vines from the first Hook, shows blocks, word counts and runtime at
your WPM, lets you edit the cards from there, creates the next block on Enter, flags branches/cycles, lists
script blocks that are off the path, exports Markdown/text and runs a teleprompter.

**Persistence** — dirty-entity saves (a one-card change ships ~150 bytes), autosave 400 ms, automatic
snapshots every ten minutes, a history drawer, daily backups, and `.bloom` zip bundles (manifest + board +
attachments) with import that always creates a new board.

**Ask** — an Anthropic panel driven entirely from Rust. The key never reaches the webview, and nothing is
sent until you press an action.

## Persian (فارسی)

Switch in **Settings → Language** or the More menu. The whole interface flips to `dir="rtl"` and Persian
renderings of the same tokens, with no new colours or spacing rules:

- **Fonts** ship inside the app (`ui/fonts/`): Vazirmatn variable for the UI, Amiri for hooks, script text
  and the wordmark. Both are declared with `unicode-range`, so Latin characters stay in Inter / Instrument
  Serif and Persian characters fall through automatically — mixed cards work per glyph.
- **Typography**: tracking is removed (it breaks Persian joins), labels drop uppercase, leading grows
  (body 1.85, script 1.9, hooks 1.6), and numbers are Persian everywhere the app formats them.
- **Direction**: chrome mirrors through logical CSS (`inset-inline-*`, `margin-inline-*`); card contents use
  `dir="auto"`, so an English card on a Persian board still reads left-to-right. Canvas coordinates never
  mirror.
- Strings live in `ui/i18n.js` (English + Persian, ~230 keys). Adding a locale means one dictionary and one
  entry in the language picker.

## Hotkeys

`V` select · `H` pan · `N` add · `F` frame · `P` pen · `E` eraser · `R` rect · `O` ellipse · `L` arrow ·
`I` image · `/` add · `Ctrl+K` search · `Ctrl+Enter` canvas/script · `Ctrl+H` history · `Ctrl+J` ask ·
`Ctrl+,` settings · `Ctrl+S` snapshot · `Ctrl+E` export · `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo ·
`Ctrl+D` duplicate · `Ctrl+]`/`[` z-order · arrows nudge (Shift 8px) · `G` snap · `?` shortcuts · `F11`
fullscreen.

## Notes

- The design is frozen: all colours are `:root` tokens, no hex outside it, no emoji, inline SVG icons,
  44px targets, 2px accent focus rings, 120–180 ms colour/shadow/opacity transitions only.
- Known gaps are listed in `REPORT.md` (single-instance guard, geometric frame containment).
