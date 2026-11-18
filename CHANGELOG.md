# Changelog

## Android + phones (0.1.0)
- New target: **Android** (arm64), same codebase. Desktop-only paths sit behind `cfg(desktop)` — window-rect
  persistence, the asset-protocol scope and the `.bloom` argv scan — and the API key is stored in a 0600 file
  inside app-private storage instead of the Credential Manager. Nothing else in the Rust core changed.
- Phone layout (`≤ 720px`): the top-left keeps brand and board name, every control moves to a bottom row above
  the tool bar, the minimap hides (no room), the zoom pill rides above the tools, the command bar becomes a
  bottom sheet, the start screen and the script view go fluid, and project nodes stack in one column.
- Touch: two fingers pinch to zoom and pan together (pointer events, capture phase, so a pinch never starts a
  card drag); `touch-action: none` on the viewport. A board opens fit-to-screen on a phone instead of inheriting
  a desktop viewport, and rotates back to fit when the width crosses the breakpoint.
- The AI panel is hidden on phones: its stream path shells out to `curl.exe`, which Android does not have.
- `release.yml` builds the NSIS installer and a debug-signed arm64 APK on every tag, then attaches both to the
  GitHub release.

## Project screen: every board is a node
- New default view on the start screen: **Nodes**. Each board is drawn as an idea node on the same 24 px dot
  grid as the canvas — tint dot, `IDEA` label, status word, title, card count and edited time. Positions are
  free: drag a node and its coordinates are stored in settings (`projectsNodes`), so the map you build survives
  restarts. Click opens the board; a drag never triggers the open.
- `List` and `Board` stay one segment away. Filter pills, search and sort apply to the node view too.
- Nodes carry `dir="auto"`, so a Persian board's node mirrors internally (dot on the right) while the rest of the
  screen keeps its own direction; chrome stays logical, node coordinates stay physical like canvas cards.
- Fixed `goto()` clearing the wrong segment: it toggled `is-active` on every `.seg`, including the new
  projects/Nodes segment, which left no view highlighted.

## Command bar fixed: dots and adding
- **Nothing could be added from the command bar.** `runPaletteActive()` called `closePalette()` — which nulls
  the `opts` object — and then read `opts.onAdd`, throwing `TypeError: Cannot read properties of null`, caught by
  the global handler as “Something went wrong”. The callbacks are now captured before the bar closes, so add,
  draw and search-focus all work.
- **Most rows had no dot.** The palette and the context bar ask for `--tint-accent`, `--tint-pen`,
  `--tint-text-2` and `--tint-text-muted`, which were never defined; six of the nine rows rendered an 8 px
  transparent dot. Aliases added in `:root` (no new hex values).
- A search that matched cards put the “On this board” header at index 0, so Enter did nothing; group rows are
  now skipped by the arrow keys and by the initial selection.

## Language switch made discoverable
- A **language button in the top bar** (`#lang-btn`, 44px, next to Ask/More) shows the target language —
  `EN` while Persian is active, `فا` while English is — and flips the interface in one click.
- The More-menu entry now names the target language: “تغییر به انگلیسی” / “Switch to Persian”, instead of
  repeating the current one.
- Settings → Language still holds the same control; all three write `settings.locale`.

## Persian (فارسی) version — RTL, Persian fonts, one accent
- No new colours, radii or shadows: the Persian interface reuses every token.
- Two bundled families, no CDN: **Vazirmatn** (variable 100–900, arabic + latin subsets) for the UI and
  **Amiri** (400, arabic + latin) for hooks, script text and the wordmark. Both are declared with
  `unicode-range`, so Latin characters stay in Inter / Instrument Serif and Persian characters fall through
  to the Persian face — per glyph, no wrapper spans. `ui/fonts/vazirmatn-{arabic,latin}.woff2`,
  `ui/fonts/amiri-{arabic,latin}.woff2` (190 KB total).
- `ui/i18n.js`: English + Persian dictionaries (~230 keys), `t(key, vars)`, `num()` (Persian digits),
  `localizeDigits()`, `setLocale()`, `applyStatic()` for `data-i18n` / `data-i18n-placeholder` /
  `data-i18n-title` / `data-i18n-aria`, and an `onLocaleChange` hook.
- **Direction**: `setLocale("fa")` sets `<html lang="fa" dir="rtl">`. The chrome moved to logical properties
  (`inset-inline-start/end`, `margin-inline-*`, `border-inline-start`, `text-align: start`), so the brand,
  view toggle, minimap, zoom, drawers and the frame label mirror without duplicating any rule. Canvas world
  coordinates stay physical. Every editable field carries `dir="auto"`, so a card can hold Persian and English
  side by side and each line flows on its own.
- **Persian typography**: `letter-spacing: 0` everywhere (tracking breaks the joins), labels lose
  `text-transform: uppercase` (Persian has no case), leading grows — card body 1.85, script rows 1.9,
  hooks 1.6, sticky 1.75 — and the label/meta join uses a Persian comma so “بخش ۱” and “۲۷ واژه” do not read
  as one number.
- **Digits** are Persian wherever the app formats a number: zoom, word counts, seconds, runtime, card counts,
  snapshot times, project meta, the status pipeline and the teleprompter. User-typed text is untouched.
- Language switch lives in Settings → Language and in the More menu; the choice is stored in the `settings`
  table (and mirrored to `localStorage` for the browser preview).
- All surfaces localised: chrome, tooltips, command bar (items + search group), context bar, menus, palette
  placeholders, script view (labels, stats, warnings, off-path block), teleprompter, projects screen
  (filters use `data-filter` so the canonical status survives translation), templates, settings, history,
  Ask panel (its prompt tells the model to answer in Persian), cheat sheet, first-run hints, About, toasts.
- Card type labels, shot statuses, hook styles, frame defaults and the script-path pill are translated at
  render time; `engine.invalidateAll()` forces a rebuild after a locale switch so cached card markup
  re-labels itself.

## Phase F — settings, shell, docs
- Settings dialog (Ctrl+,): words per minute, snap default, scroll mode, reduce-motion override, model,
  API key (write-only, replace/remove, Test), backups folder, hints reset. Persisted in `settings`.
- Window size and position persist across launches (min 900×600).
- About dialog with Copy diagnostics and Open data folder.
- CSP tightened; asset protocol scoped to `%APPDATA%\com.bloom.app\attachments`.
- README rewritten for the real app.
- **Rotating log**: `%APPDATA%\com.bloom.app\logs\bloom.log`, rotated at 1 MB to `bloom.log.1`, written by
  Rust on start and on every save; the webview forwards uncaught errors through `log_client`. About →
  Copy diagnostics now includes the tail, and Open logs opens the folder.
- **API key moved to the Windows Credential Manager** (`keyring`, service `com.bloom.app`, account
  `anthropic`). Old keys found in `settings` are migrated at startup and the row deleted.
- Settings shows “Key saved in the OS keychain” with Replace / Remove / Test instead of a blind field.
- `Enter` on a focused card starts editing (A14).
- AI critique results render `[S1]` references as buttons that pan to that script block.
- Bundle configured for **NSIS** (current-user install) with a `.bloom` file association and the required
  icon sizes (32, 128, 128@2x, ico).
- Hardening: `fs:default` removed from the window capability — picked images come through the
  `read_image_file` command (extension and 40 MB guards) instead of granting the webview file access.
  Verified that `plugin:fs|read_file` is now refused.
- Image cards keep their aspect ratio while resizing unless Shift is held.
- Opening a `.bloom` from Explorer (or `Bloom.exe file.bloom`) imports it at startup: the path is kept in
  Rust and handed to the frontend once (`take_launch_file`), which runs the normal import flow.
- **Cross-board id collisions fixed**: ids are primary keys in every table, so seeds, duplicates and
  imports now get fresh ids (and vine endpoints remapped) before they are written. Verified by switching
  between two boards seeded from the same template: both keep 8 cards in the database.
- A debounced save from the previous board can no longer land on the board you just opened
  (`applyBoard` cancels the pending timer, `onBoardLoaded` flushes first).

## Phase E — Ask panel
- Right drawer (Ctrl+J): model chip, context chips, expandable "What will be sent" preview, six actions
  (hook variations, tighten, expand, titles, retention critique, B-roll) plus a free prompt.
- Rust streams Anthropic Messages API SSE through `curl.exe`, emitting `ai://chunk` / `ai://done` /
  `ai://error`; `ai_cancel` kills the child process.
- Result blocks: Insert as card (with vine to the anchor), Replace text, Copy. Nothing is sent until an
  action is triggered.
- **Deviation:** the key is stored in the `settings` table behind an API wall (`get_settings` strips it;
  no command returns it) instead of the OS keychain — the `keyring` crate is not cached for offline builds.
  Verified: no-key path returns "no API key saved" and a toast. Not verified: a live completion (no key).

## Phase C — script view, export, teleprompter
- Script text is editable in place and edits the underlying card; stats update per keystroke.
- Enter at the end of a block creates a linked script card (vine inserted between block and its successor).
- Backspace in an empty block deletes it and reconnects neighbours.
- Hook style and shot status cycle from the margin cards.
- Off-path section lists script blocks outside the path with "Add to path".
- Export menu: Markdown, plain text, copy script (Ctrl+E). Teleprompter: size 32–96, speed, play/pause
  (Space), mirror (M), reading line at 38%, Esc.

## Phase B — history, backups, incremental persistence
- History drawer (Ctrl+H, 320px): snapshots newest first with time, label and card count, Snapshot now,
  Restore (with automatic "before restore" and an undo toast).
- Launch + 24h `VACUUM INTO` backups in `backups/`, last seven kept.
- Dirty-entity saves (`apply_changes`): only changed cards/vines/frames/strokes/shapes are upserted or
  deleted. Measured one-card save payload: **142–163 bytes**.
- History is entity patches (`before`/`after` per entity), cap raised to **200**.
- A loaded board now marks every entity dirty once, so the database converges on what is on screen and a
  stale index can never schedule deletes.

## Phase A — UX foundations
- Copy/paste/duplicate carry vines whose both ends are selected, ids remapped, script-path kinds kept;
  paste at pointer, else +24px. System clipboard gets an app JSON payload; external paste maps
  image → Image card, URL → Source card, text → sticky.
- Plain-text paste everywhere (contenteditable), newlines preserved, foreign HTML stripped.
- Shift+drag box select adds; Ctrl/Cmd+click toggles; vines and strokes inside the box are selected.
- Frames: 8 handles (min 120×80), label edit on double-click.
- Saved / Saving… / Couldn't save indicator with retry (aria-live).
- Delete toast with Undo, 5s, pause on hover, max 3.
- Pins: 4 dots per card on hover; drag to a card connects, drag to empty canvas opens the command bar and
  connects the new card; vine endpoints re-drag to reroute; double-click a vine or label to edit it.
- Selection context bar: type switcher (keeps unmapped fields in `card.extra`), duplicate, connect, delete,
  sticky fill swatches; multi-select align/distribute/group; vine/frame/stroke actions.
- Unified command bar: add items + "On this board" search, Enter pans/zooms and pulses the card (600ms).
  Ctrl+K searches, "/" adds, the top-right button adds.
- Arrows nudge 1px (Shift 8px), alignment guides at 60% opacity within 6px/zoom, Ctrl+] / [ z-order.
- Pen popover: Pen, Eraser, Rectangle, Ellipse, Arrow; 6 colour tokens; 3 widths; P/E/R/O/L hotkeys.
  Shapes live in the new `shapes` table, selectable and resizable; the eraser removes touched strokes/shapes.
- Cheat sheet "?", three first-run hints persisted in settings.
- Scroll setting (zoom for mouse / pan for trackpad), Ctrl+wheel always zooms.
- Cards are `role="group"` with type + first-line aria-labels, tab order follows reading order (y, then x).
- Top-right AI and More buttons; More menu: Projects, History, Ask, Import, Export .bloom, Export script,
  Settings, Shortcuts, About.

## Schema v3
- New tables `shapes`, `settings`; `projects.archived|deleted_at|tags`; `cards.extra`;
  `attachments.hash|bytes`; indexes per project.
- Before migrating from v2 the database is copied to `bloom.db.bak-v2` (verified on the real DB).

## New tokens
- `--source #8FC7B8`, `--tint-source`, `--tint-image`
- `--pen-default #E3C778`, `--pen-text #ECEAE4`, `--pen-accent #A8D672`, `--pen-shot #7FB2E5`,
  `--pen-titles #E58F9A`, `--pen-thumb #C9A8E8`
