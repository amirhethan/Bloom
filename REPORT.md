# Bloom — report for the autonomous run (phases A–F)

Build: `src-tauri/target/debug/Bloom.exe` (Tauri 2.12, rusqlite bundled, schema v3).
Frontend: no bundler, ES modules — `store.js`, `engine.js`, `palette.js`, `script.js`, `projects.js`,
`history.js`, `ai.js`, `settings.js`, `media.js`, `templates.js`, `overlay.js`, `app.js`.

## Measured

| check | result |
|---|---|
| v2 → v3 migration on the existing DB | `PRAGMA user_version` = 3; `bloom.db.bak-v2` written before migrating; prior board, frames, vines, strokes and snapshots loaded unchanged |
| render, 520 cards | **15 ms**, 523 DOM nodes |
| commit, one card, 520 cards | **8.5 ms** |
| render, 2 000 cards | **65 ms**, 2 003 DOM nodes |
| commit, one card, 2 000 cards | **28.6 ms** (history cap 200, entities serialised only when touched) |
| save payload, one card changed | **142–163 bytes** over IPC (`apply_changes`) |
| backups | `backup_now` → `backups/bloom-20261117-172516.db`; folder command returns the path |
| .bloom round trip | export (stored zip: `manifest.json`, `board.json`, `attachments/`) → import created a new project with 12 cards, ids remapped |
| script block from Enter | script cards 2 → 3 and the path re-walked (after fixing the vine-rewire order) |
| script stats | 105 words / 0:42 → 108 / 0:43 while typing |
| 900×600 | top-left and top-right chrome do not overlap, `scrollWidth/Height` = 900×600 |
| console | 0 exceptions across the final runs; no `console.error` |
| database after the run | 1 project, 8 cards, 3 vines, 1 frame, 1 stroke, 0 shapes — matches the screen |

## Follow-up pass (all previously open items)

| gap | result |
|---|---|
| API key storage | moved to the Windows Credential Manager (`keyring`, service `com.bloom.app`). Set → `ai_status.hasKey = true`, **0 rows** named `ai.key` in `settings`, settings dialog shows “Key saved in the OS keychain · Replace · Remove”; clear → `hasKey = false` |
| Live Anthropic request | `ai_test` reached the API and returned a real `authentication_error` with a `request_id` for a deliberately invalid key — the request path, headers and response parsing are proven; only a valid key is missing |
| Rotating log | `logs/bloom.log` exists, contains the `start v0.1.0` line and a webview probe line; `tail_log` returns it |
| Page title fetch | `https://github.com` → `"GitHub · Change is constant…"`, exactly 524288 bytes read then the download is killed (cap honoured) |
| Image ingest | canvas → PNG bytes → `save_attachment` → `attachments/<hash>.png`, 208 bytes, deduped hash, rendered through the asset protocol (`naturalWidth` 64) |
| Snapshot restore (drawer) | 8 cards → delete one → Restore from the drawer → 8 cards again, DB in sync |
| Enter to edit | click a card, press Enter → `document.activeElement` is the card's `title` field (A14) |
| AI `[S1]` refs | rendered as buttons that pan to the corresponding script block |
| Picked images | `read_image_file` (extension + 40 MB guard) returns the bytes; the webview's `fs` permission was removed and `plugin:fs|read_file` now fails with "fs blocked", so images can only enter through Rust |
| Shift-resize | image cards keep their aspect ratio unless Shift is held |
| Opening a `.bloom` from the shell | `Bloom.exe probe.bloom` booted, consumed the path, created a new project (17 cards) and opened it |
| Installer | `cargo tauri build` → `bundle/nsis/Bloom_0.1.0_x64-setup.exe` (5.04 MiB). Silent install put `Bloom.exe`, `uninstall.exe` and `WebView2Loader.dll` in `%LOCALAPPDATA%\Bloom`, registered `HKCU\Software\Classes\.bloom` → ProgID “Bloom board” with command `"...\Bloom.exe" "%1"`, and the installed exe imported a `.bloom` passed on the command line |
| Release build | `target/release/Bloom.exe` runs standalone (with `WebView2Loader.dll` beside it), schema 3, 8 cards, zero exceptions |
| Board switching | two boards seeded from the same template, switched back and forth: 8/8 cards in the database before and after, no id theft |
| Shipped release | `target/release/Bloom.exe` on an empty database: first run seeded 8 cards / 3 vines / 1 frame, schema 3, **0 exceptions** across script view, Ask, History, Settings and the projects screen |

## Persian (fa) — measured in the shipped build

| Check | Result |
|---|---|
| Locale boot | `settings.locale = fa` → `<html lang="fa" dir="rtl">`, status pill “طرح کلی”, zoom “۸۶٪” |
| Fonts | `document.fonts.check('16px Vazirmatn','پ چ ژ گ')` **true**, `check('22px Amiri','پ چ ژ گ')` **true**; loaded families Inter, Instrument Serif, Vazirmatn, Amiri |
| Persian metrics | `.card-label` letter-spacing **normal**, uppercase removed; body 13px × **1.85**, hook 22px × **1.6**, script row × **1.9** |
| Card labels | All nine types render Persian (`ایده`, `قلاب`, `متن`, `نما`, `عنوان‌ها`, `تصویر شاخص`, `برگه`, `تصویر`, `منبع`) |
| Script view | “مسیر متن: ۳ بلوک، ۶۸ واژه، حدود ۰:۲۷ با ۱۵۰ واژه در دقیقه”; rows `قلاب`, `بخش ۱`, `بخش ۲` with `۲۷ واژه، حدود ۱۱ ثانیه` |
| Mirroring | brand right, view toggle left, minimap left, zoom right, drawer on the left, frame label on the card’s right |
| Mixed direction | every editable field `dir="auto"`; an English card on the Persian board keeps LTR text inside an RTL layout |
| 900×600 | brand 523→880, tools 20→279 — no intersection, toolbar 24px from the bottom |
| Round trip | switch to English through Settings: chrome back to `Outlined / Saved / Canvas / Script`, labels `IDEA HOOK SCRIPT…`, board content untouched |
| Errors | 0 exceptions, 0 console errors across canvas, script, palette, settings, projects |

## Verified by hand (through the real UI)

- Context bar on a single card: type switcher, duplicate (10 → 11 cards, undo back to 10), delete toast.
- Pin drag from `shot1` to `titles1` created a vine (6 → 7).
- Rectangle shape drawn with the pen popover (state + SVG), eraser defined, shapes persisted to `shapes`.
- Settings dialog opens from anywhere (including while a script field is focused), shows 8 fields, saving
  WPM persisted (`state.wpm` 150 → 170 and back through settings).
- History drawer opens with 5 snapshots (time, label, card count, Restore).
- Ask drawer opens with 6 actions and 3 context chips; triggering an action without a key produced the
  calm "Add an Anthropic key in Settings" toast and an inline error, never a crash.
- Command bar: 9 add items, "On this board" search results when typing.
- Projects screen: list and board (6 status columns) views, project opens back into the canvas with the
  right card count.
- Data safety loop after the persistence fix: 8 cards → insert 1 → save → reload → 9 in the DB and on screen.

## Not verified (and why)

- **A successful AI completion.** The request/stream plumbing is proven (real `request_id` from Anthropic),
  but no valid key exists on this machine, so no tokens were streamed and no result block was filled.
- **Native dialogs** (save/open for export, import, image pickers) cannot be automated on this host; every
  file code path was exercised by invoking the command with an explicit path.
- **Drag-and-drop of an image file** was not simulated; the same `save_attachment` path was exercised
  through a generated PNG instead.

## Limits that remain

1. Only one Bloom window can run at a time: two instances share the WebView2 user-data folder and the
   second fails to create its webview. A single-instance guard (focus the running window instead) is the
   proper fix; it needs the single-instance plugin, which is not cached for offline builds.
2. Frames resize from their handles, but a card cannot be dropped *onto* a frame to join it — containment
   is geometric (as specified).
5. Orphan rows can survive in the database if a board is replaced outside the app's own flows (the store
   now mirrors a loaded board completely, so normal open/edit/reload cycles converge).
6. Shapes are outline-only and do not participate in align/distribute.
7. The AI panel is text-only: no markdown rendering, and critique references are matched by `[S1]`-style
   text rather than clickable spans.
8. Rich text is deliberately absent: paste is always plain text, as specified.
