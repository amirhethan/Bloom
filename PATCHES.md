# Bloom — bug fixes, mechanical patch set

Verified against the working tree (`ui/*.js`, `src-tauri/src/*.rs`, `tauri.conf.json`), which matches CODE.md.
Format: `### path`, then `<<<<<<< SEARCH` / `======= ` / `>>>>>>> REPLACE` blocks, each labelled with its item id.

Tier A is complete. Tier B/C carry the items listed under "UNFINISHED" at the end.

> **Already applied to the working tree (skip these blocks if you re-apply this file):** the B16 palette-block
> in `ui/palette.js` is in the repo, together with two command-bar fixes found while debugging an empty
> palette — see `ui/palette.js` `runPaletteActive` (callbacks captured before `closePalette()` nulls `opts`)
> and the `--tint-accent` / `--tint-pen` / `--tint-text-2` / `--tint-text-muted` aliases in `style.css`.

---

## ui/store.js

### ui/store.js

<!-- A1: a save must not swallow edits made while it is in flight -->

<<<<<<< SEARCH
export async function saveNow() {
  clearTimeout(saveTimer);
  mirror();
  if (saving) return saving;
  const { changes, touched } = collectChanges();
  const payloadBytes = JSON.stringify(changes).length;
  if (!touched && !viewportDirty && !wpmDirty) {
    saveState("saved", { bytes: 0 });
    return { ok: true, touched: 0, bytes: 0 };
  }
  if (!invoke || !state.projectId) {
    for (const entity of ENTITIES) {
      dirty[entity].clear();
      removed[entity].clear();
    }
    viewportDirty = false;
    wpmDirty = false;
    saveState("saved", { bytes: payloadBytes });
    return { ok: true, local: true, touched, bytes: payloadBytes };
  }
  saveState("saving");
  saving = (async () => {
    try {
      const res = await invoke("apply_changes", { projectId: state.projectId, changes });
      for (const entity of ENTITIES) {
        dirty[entity].clear();
        removed[entity].clear();
      }
      viewportDirty = false;
      wpmDirty = false;
      saveState("saved", { bytes: payloadBytes, snapshotted: res?.snapshotted });
      return { ok: true, touched, bytes: payloadBytes, ...res };
    } catch (err) {
      console.error("save failed", err);
      saveState("error", { error: String(err) });
      return { ok: false, error: String(err), touched, bytes: payloadBytes };
    } finally {
      saving = null;
    }
  })();
  return saving;
}
=======
const hasPending = () =>
  viewportDirty || wpmDirty || ENTITIES.some((entity) => dirty[entity].size || removed[entity].size);

/** Clears only what this request actually carried. An id that changed again while
 *  the request was in flight stays dirty and ships on the next pass. */
function clearSent(sent, viewport, wpm) {
  for (const entity of ENTITIES) {
    for (const [id, jsonAtSend] of sent[entity].upsert) {
      const item = state[entity].find((it) => it.id === id);
      if (!item || json(entity, item) === jsonAtSend) dirty[entity].delete(id);
    }
    for (const id of sent[entity].del) {
      if (!state[entity].some((it) => it.id === id)) removed[entity].delete(id);
    }
  }
  if (
    viewportDirty &&
    state.viewport.x === viewport.x &&
    state.viewport.y === viewport.y &&
    state.viewport.zoom === viewport.zoom
  ) {
    viewportDirty = false;
  }
  if (wpmDirty && state.wpm === wpm) wpmDirty = false;
}

async function savePass() {
  const { changes, touched } = collectChanges();
  const sent = {};
  for (const entity of ENTITIES) {
    sent[entity] = {
      upsert: new Map((changes[entity]?.upsert || []).map((item) => [item.id, json(entity, item)])),
      del: new Set(changes[entity]?.delete || []),
    };
  }
  const viewport = { ...state.viewport };
  const wpm = state.wpm;
  const payloadBytes = JSON.stringify(changes).length;
  if (!touched && !viewportDirty && !wpmDirty) {
    saveState("saved", { bytes: 0 });
    return { ok: true, touched: 0, bytes: 0 };
  }
  if (!invoke || !state.projectId) {
    for (const entity of ENTITIES) {
      dirty[entity].clear();
      removed[entity].clear();
    }
    viewportDirty = false;
    wpmDirty = false;
    saveState("saved", { bytes: payloadBytes });
    return { ok: true, local: true, touched, bytes: payloadBytes };
  }
  saveState("saving");
  try {
    const res = await invoke("apply_changes", { projectId: state.projectId, changes });
    clearSent(sent, viewport, wpm);
    saveState("saved", { bytes: payloadBytes, snapshotted: res?.snapshotted });
    return { ok: true, touched, bytes: payloadBytes, ...res };
  } catch (err) {
    console.error("save failed", err);
    saveState("error", { error: String(err) });
    return { ok: false, error: String(err), touched, bytes: payloadBytes };
  }
}

export async function saveNow() {
  clearTimeout(saveTimer);
  mirror();
  // one drain at a time: callers resolve when nothing is left to write
  if (saving) return saving;
  saving = (async () => {
    let last = { ok: true, touched: 0, bytes: 0 };
    try {
      if (!hasPending()) {
        saveState("saved", { bytes: 0 });
        return last;
      }
      for (let guard = 0; guard < 20 && hasPending(); guard++) last = await savePass();
      return last;
    } finally {
      saving = null;
    }
  })();
  return saving;
}
>>>>>>> REPLACE

### ui/store.js

<!-- A2: undoing a creation must tell the database the row is gone -->

<<<<<<< SEARCH
function applyPatch(ops, direction) {
  const dropping = new Set();
  for (const op of [...ops].reverse()) {
    const snapshot = direction === "undo" ? op.before : op.after;
    const entity = state[op.entity];
    const at = entity.findIndex((item) => item.id === op.id);
    if (snapshot == null) {
      if (at >= 0) entity.splice(at, 1);
      continue;
    }
    const item = JSON.parse(snapshot);
    if (at >= 0) entity[at] = item;
    else entity.push(item);
    dropping.add(op.entity);
  }
=======
function applyPatch(ops, direction) {
  const dropping = new Set();
  for (const op of [...ops].reverse()) {
    const snapshot = direction === "undo" ? op.before : op.after;
    const entity = state[op.entity];
    const at = entity.findIndex((item) => item.id === op.id);
    // every touched entity is reconciled, including the ones this op deletes
    dropping.add(op.entity);
    if (snapshot == null) {
      if (at >= 0) entity.splice(at, 1);
      continue;
    }
    const item = JSON.parse(snapshot);
    if (at >= 0) entity[at] = item;
    else entity.push(item);
  }
>>>>>>> REPLACE

### ui/store.js

<!-- B9: remember which board was open, and keep WPM in the board row -->

<<<<<<< SEARCH
  resetHistory();
  // A loaded board is authoritative: mirror every entity so the next save
  // converges on it, and never let a stale index schedule deletes.
=======
  // boot() reads this key; nothing wrote it before, so every launch reopened the oldest board
  if (state.projectId) saveSettings({ lastProject: state.projectId }).catch(() => {});
  resetHistory();
  // A loaded board is authoritative: mirror every entity so the next save
  // converges on it, and never let a stale index schedule deletes.
>>>>>>> REPLACE

---

## ui/app.js

### ui/app.js

<!-- A5+B4: switch to the canvas rebuilds it; script listeners are wired once -->

<<<<<<< SEARCH
  if (name === "canvas") {
    engine.applyTransform();
    engine.renderMinimap();
  }
=======
  if (name === "canvas") {
    // the canvas has zero layout while the script view is shown, so vine and
    // handle geometry has to be rebuilt, not just re-transformed
    engine.renderAll();
  }
>>>>>>> REPLACE

### ui/app.js

<!-- A5: initScript is called on every board load; it must be idempotent -->

(see ui/script.js below)

### ui/app.js

<!-- A6: the clipboard lives in engine.js as a module binding, not a namespace property -->

<<<<<<< SEARCH
  if (fromSystem?.cards?.length) {
    engine.clipboard = fromSystem;
  } else if (!payload && text.trim()) {
=======
  if (fromSystem?.cards?.length) {
    engine.setClipboard(fromSystem);
  } else if (!payload && text.trim()) {
>>>>>>> REPLACE

### ui/app.js

<!-- B5: a card created by dropping a pin lands where the pointer is -->

<<<<<<< SEARCH
function addThing(type, connection) {
  if (type === "frame") {
    engine.insertFrame();
    return;
  }
  const card = engine.insertCard(type);
  if (connection?.from && card) engine.connect(card.id, connection.from, connection.fromPin);
  updateContextBar();
}
=======
function addThing(type, connection, at) {
  if (type === "frame") {
    engine.insertFrame(at);
    return;
  }
  const card = engine.insertCard(type, at);
  if (connection?.from && card) engine.connect(card.id, connection.from, connection.fromPin);
  updateContextBar();
}
>>>>>>> REPLACE

<<<<<<< SEARCH
    onPinDrop: (world, connection) => openAdd("", connection),
=======
    onPinDrop: (world, connection) => openAdd("", connection, world),
>>>>>>> REPLACE

<<<<<<< SEARCH
function openAdd(seed = "", connect = null) {
  openPalette({
    mode: "add",
    seed,
    connect,
    onAdd: (type, connection) => addThing(type, connection),
=======
function openAdd(seed = "", connect = null, at = null) {
  openPalette({
    mode: "add",
    seed,
    connect,
    onAdd: (type, connection) => addThing(type, connection, at),
>>>>>>> REPLACE

### ui/app.js

<!-- B3a/b: the context bar rebuilds itself every 400 ms and its type select has no handler -->

<<<<<<< SEARCH
  bar.hidden = false;
  bar.innerHTML = contextBarMarkup();
  bar.style.left = `${Math.round(screenBox.x + screenBox.w / 2)}px`;
=======
  bar.hidden = false;
  // rebuilding on a timer closes an open <select> and eats the click
  const signature = contextSignature();
  if (bar.dataset.sig !== signature) {
    bar.innerHTML = contextBarMarkup();
    bar.dataset.sig = signature;
  }
  bar.style.left = `${Math.round(screenBox.x + screenBox.w / 2)}px`;
>>>>>>> REPLACE

<<<<<<< SEARCH
function contextBarMarkup() {
  const { sel } = store;
=======
function contextSignature() {
  const { sel } = store;
  const card = sel.cards.size === 1 ? store.cardById([...sel.cards][0]) : null;
  return [
    engine.selectionCount(),
    [...sel.cards].sort().join(","),
    [...sel.vines].sort().join(","),
    [...sel.frames].sort().join(","),
    [...sel.strokes].sort().join(","),
    [...sel.shapes].sort().join(","),
    card?.type || "",
    card?.fill || "",
  ].join("|");
}

function onContextChange(e) {
  const select = e.target.closest("[data-type-switch]");
  if (!select) return;
  const card = store.cardById([...store.sel.cards][0]);
  if (!card) return;
  if (store.convertCardType(card, select.value)) {
    store.commit("type");
    engine.invalidateAll();
    engine.renderAll();
    updateContextBar();
  }
}

function contextBarMarkup() {
  const { sel } = store;
>>>>>>> REPLACE

<<<<<<< SEARCH
  if (!ctxBound) {
    bar.addEventListener("click", onContextClick);
    ctxBound = true;
  }
}
=======
  if (!ctxBound) {
    bar.addEventListener("click", onContextClick);
    bar.addEventListener("change", onContextChange);
    ctxBound = true;
  }
}
>>>>>>> REPLACE

### ui/app.js

<!-- B6: global hotkeys must stand down while a modal or the teleprompter is open -->

<<<<<<< SEARCH
    const mod = e.ctrlKey || e.metaKey;
    const typing = isTyping(e);
=======
    // a modal, a drawer form or the teleprompter owns the keyboard; only Escape
    // (handled above) still reaches the canvas
    if (modalOpen() || document.querySelector(".prompter")) return;
    const mod = e.ctrlKey || e.metaKey;
    const typing = isTyping(e);
>>>>>>> REPLACE

### ui/app.js

<!-- C3: setLocale already notifies listeners, so refreshLocale ran twice -->

<<<<<<< SEARCH
function switchLocale() {
  const next = getLocale() === "fa" ? "en" : "fa";
  setLocale(next);
  store.saveSettings({ locale: next });
  refreshLocale();
}
=======
function switchLocale() {
  const next = getLocale() === "fa" ? "en" : "fa";
  // setLocale fires onLocaleChange -> refreshLocale
  setLocale(next);
  store.saveSettings({ locale: next });
}
>>>>>>> REPLACE

### ui/app.js

<!-- B14: file names keep non-Latin letters -->

<<<<<<< SEARCH
      options: { defaultPath: `${(project?.name || "board").replace(/[^\w\- ]+/g, "").trim()}.bloom`, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
=======
      options: { defaultPath: `${(project?.name || "board").replace(/[\\/:*?"<>|]+/g, "").trim() || "board"}.bloom`, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
>>>>>>> REPLACE

---

## ui/engine.js

### ui/engine.js

<!-- A6: copy/paste through the exported setter, and never clobber the clipboard -->

<<<<<<< SEARCH
export function copySelection() {
  const cards = state.cards.filter((c) => sel.cards.has(c.id)).map((c) => JSON.parse(JSON.stringify(c)));
  const ids = new Set(cards.map((c) => c.id));
  const vines = state.vines.filter((v) => ids.has(v.from) && ids.has(v.to)).map((v) => JSON.parse(JSON.stringify(v)));
  clipboard = { cards, vines };
  return clipboard;
}
=======
export function copySelection() {
  const cards = state.cards.filter((c) => sel.cards.has(c.id)).map((c) => JSON.parse(JSON.stringify(c)));
  // Ctrl+C with nothing selected must not wipe what is already on the clipboard
  if (!cards.length) return clipboard;
  const ids = new Set(cards.map((c) => c.id));
  const vines = state.vines.filter((v) => ids.has(v.from) && ids.has(v.to)).map((v) => JSON.parse(JSON.stringify(v)));
  clipboard = { cards, vines };
  return clipboard;
}

/** Takes an app payload read back from the system clipboard. */
export function setClipboard(payload) {
  if (!payload?.cards?.length) return false;
  clipboard = { cards: payload.cards, vines: payload.vines || [] };
  return true;
}
>>>>>>> REPLACE

<<<<<<< SEARCH
export function duplicateSelection() {
  if (!copySelection().cards.length) return 0;
  return pasteInternal(null, { offset: 24 });
}
=======
export function duplicateSelection() {
  const cards = state.cards.filter((c) => sel.cards.has(c.id));
  if (!cards.length) return 0;
  const saved = clipboard;
  copySelection();
  const n = pasteInternal(null, { offset: 24 });
  // Ctrl+D is not a copy: put the user's clipboard back
  clipboard = saved;
  return n;
}
>>>>>>> REPLACE

### ui/engine.js

<!-- B4: geometry falls back to the model when the element has no layout -->

<<<<<<< SEARCH
const rectOf = (id) => {
  const el = cardEls.get(id);
  return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
};
=======
const rectOf = (id) => {
  const el = cardEls.get(id);
  // the canvas has no layout while the script view is shown: offsetWidth is 0
  if (el && el.offsetWidth) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const card = cardById(id);
  if (!card) return null;
  return { x: card.x, y: card.y, w: card.w || 240, h: card.h || 120 };
};
>>>>>>> REPLACE

### ui/engine.js

<!-- B5: the target pin is the one nearest the source card, not always "top" -->

<<<<<<< SEARCH
export function connect(cardId, from, fromPin) {
  const toCard = cardById(cardId);
  if (!toCard) return null;
  const vine = {
    id: uid("v"),
    from,
    fromPin: fromPin || "right",
    to: cardId,
    toPin: nearestPin(toCard, { x: toCard.x, y: toCard.y }),
    kind: "vine",
  };
=======
export function connect(cardId, from, fromPin) {
  const toCard = cardById(cardId);
  const fromCard = cardById(from);
  if (!toCard) return null;
  const toward = fromCard
    ? { x: fromCard.x + (fromCard.w || 240) / 2, y: fromCard.y + (fromCard.h || 120) / 2 }
    : { x: toCard.x - 1, y: toCard.y };
  const vine = {
    id: uid("v"),
    from,
    fromPin: fromPin || "right",
    to: cardId,
    toPin: nearestPin(toCard, toward),
    kind: "vine",
  };
>>>>>>> REPLACE

### ui/engine.js

<!-- B3c: selection bounds include vines and strokes -->

<<<<<<< SEARCH
  for (const id of sel.shapes) {
    const s = shapeById(id);
    if (s) boxes.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  }
  if (!boxes.length) return null;
=======
  for (const id of sel.shapes) {
    const s = shapeById(id);
    if (s) boxes.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  }
  for (const id of sel.strokes) {
    const s = strokeById(id);
    if (s) boxes.push({ x: s.x, y: s.y, w: Math.max(1, s.w), h: Math.max(1, s.h) });
  }
  for (const id of sel.vines) {
    const v = vineById(id);
    const a = v ? rectOf(v.from) : null;
    const b = v ? rectOf(v.to) : null;
    if (!a || !b) continue;
    const p1 = pinPoint(a, v.fromPin || "right");
    const p2 = pinPoint(b, v.toPin || "left");
    boxes.push({
      x: Math.min(p1[0], p2[0]),
      y: Math.min(p1[1], p2[1]),
      w: Math.max(1, Math.abs(p2[0] - p1[0])),
      h: Math.max(1, Math.abs(p2[1] - p1[1])),
    });
  }
  if (!boxes.length) return null;
>>>>>>> REPLACE

### ui/engine.js

<!-- C2: tab order follows the DOM, not a positive tabindex -->

<<<<<<< SEARCH
    if (el.style.tabIndex !== String(i + 1)) el.tabIndex = i + 1;
=======
    // positive tabindex values reorder the whole window; keep natural order
    if (el.tabIndex !== 0) el.tabIndex = 0;
>>>>>>> REPLACE

### ui/engine.js

<!-- B6: space-pan must not fire while a form control has focus -->

<<<<<<< SEARCH
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.isContentEditable) {
      spaceDown = true;
      dom.viewport.classList.add("is-panning");
    }
  });
=======
  const isFormField = (el) =>
    el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName || "");
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !isFormField(e.target)) {
      spaceDown = true;
      dom.viewport.classList.add("is-panning");
    }
  });
>>>>>>> REPLACE

---

## ui/script.js

### ui/script.js

<!-- A5: listeners on #script-rows are added once -->

<<<<<<< SEARCH
export function initScript() {
  const host = $("#script-rows");
=======
let scriptWired = false;

export function initScript() {
  // called on every board load; without this guard Enter creates N blocks
  if (scriptWired) return;
  scriptWired = true;
  const host = $("#script-rows");
>>>>>>> REPLACE

### ui/script.js

<!-- B10: the teleprompter scrolls below one pixel per frame at low speeds -->

<<<<<<< SEARCH
  const textEl = el.querySelector(".prompter-text");
  textEl.textContent = content;
=======
  const textEl = el.querySelector(".prompter-text");
  textEl.textContent = content;
  textEl.setAttribute("dir", "auto");
>>>>>>> REPLACE

<<<<<<< SEARCH
  const tick = (now) => {
    if (!playing) return;
    const dt = (now - last) / 1000;
    last = now;
    stage.scrollTop += dt * (speed * 14);
    raf = requestAnimationFrame(tick);
  };
=======
  let carry = 0;
  const tick = (now) => {
    if (!playing) return;
    const dt = (now - last) / 1000;
    last = now;
    // scrollTop is an integer: keep the fraction or slow speeds never move
    carry += dt * (speed * 14);
    const step = Math.floor(carry);
    if (step > 0) {
      stage.scrollTop += step;
      carry -= step;
    }
    raf = requestAnimationFrame(tick);
  };
>>>>>>> REPLACE

### ui/script.js

<!-- B14: exported script names keep Persian letters -->

<<<<<<< SEARCH
  const safe = (state.name || "script").replace(/[^\w\- ]+/g, "").trim() || "script";
=======
  const safe = (state.name || "script").replace(/[\\/:*?"<>|]+/g, "").trim() || "script";
>>>>>>> REPLACE

---

## ui/projects.js

### ui/projects.js

<!-- A3: open the stored board, not the template object -->

<<<<<<< SEARCH
  const created = await invoke("create_project", { name: board.name, seed: board });
  await renderProjects();
  onOpen({ ...board, projectId: created.id, name: created.name, status: created.status });
  return created;
=======
  const created = await invoke("create_project", { name: board.name, seed: board });
  await renderProjects();
  // create_project remaps every id, so the template's ids no longer exist in the row
  const stored = await invoke("load_board", { projectId: created.id });
  onOpen(stored || { ...board, projectId: created.id, name: created.name, status: created.status });
  return created;
>>>>>>> REPLACE

### ui/projects.js

<!-- A4: one import handler, and it opens the imported board -->

<<<<<<< SEARCH
    const created = await invoke("import_bloom", { path });
    await renderProjects();
    toast({ text: t("toast.imported", { name: created.name }) });
    onOpen?.(created.id);
=======
    const created = await invoke("import_bloom", { path });
    await renderProjects();
    toast({ text: t("toast.imported", { name: created.name }) });
    // onOpen takes a board, not an id
    const stored = await invoke("load_board", { projectId: created.id });
    if (stored) onOpen?.(stored);
>>>>>>> REPLACE

<<<<<<< SEARCH
  $("#import-bloom")?.addEventListener("click", () => importBloom(onOpen));
=======
  // the hidden import button is wired once, in app.js wireChrome
>>>>>>> REPLACE

### ui/projects.js

<!-- B11: one separator, and a real button for the row menu -->

<<<<<<< SEARCH
          (p) => `<button class="project-row${p.id === state.projectId ? " is-current" : ""}${p.deletedAt ? " is-trashed" : ""}" data-project="${p.id}">
            <span class="p-name" dir="auto">${escapeHtml(p.name)}${p.archived ? ` <span class="p-flag">${t("projects.archivedFlag")}</span>` : ""}</span>
            ${p.tags ? `<span class="p-tags">${p.tags.split(",").filter(Boolean).map((tag) => `<span class="tag-chip">${escapeHtml(tag.trim())}</span>`).join("")}</span>` : "<span></span>"}
            <span class="pill-status${p.status === "Spark" ? " is-spark" : ""}">${t(`status.${p.status}`)}</span>
            <span class="meta">${p.cardCount === 1 ? t("projects.cardOne", { n: p.cardCount }) : t("projects.cards", { n: p.cardCount })} · ${t("projects.metaJoin")}${t("projects.edited", { when: ago(p.updatedAt) })}</span>
            <span class="row-more" data-more="${p.id}" role="button" aria-label="${t("menu.more")}">⋯</span>
          </button>`,
=======
          (p) => `<div class="project-row${p.id === state.projectId ? " is-current" : ""}${p.deletedAt ? " is-trashed" : ""}" data-project="${p.id}" role="button" tabindex="0">
            <span class="p-name" dir="auto">${escapeHtml(p.name)}${p.archived ? ` <span class="p-flag">${t("projects.archivedFlag")}</span>` : ""}</span>
            ${p.tags ? `<span class="p-tags">${p.tags.split(",").filter(Boolean).map((tag) => `<span class="tag-chip">${escapeHtml(tag.trim())}</span>`).join("")}</span>` : "<span></span>"}
            <span class="pill-status${p.status === "Spark" ? " is-spark" : ""}">${t(`status.${p.status}`)}</span>
            <span class="meta">${p.cardCount === 1 ? t("projects.cardOne", { n: p.cardCount }) : t("projects.cards", { n: p.cardCount })}${t("projects.metaJoin")}${t("projects.edited", { when: ago(p.updatedAt) })}</span>
            <button class="row-more" data-more="${p.id}" aria-label="${t("menu.more")}">⋯</button>
          </div>`,
>>>>>>> REPLACE

<<<<<<< SEARCH
  host.addEventListener("dragstart", (e) => {
=======
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-project]");
    if (!row || e.target.closest("[data-more]")) return;
    e.preventDefault();
    openProject(row.dataset.project, onOpen);
  });

  host.addEventListener("dragstart", (e) => {
>>>>>>> REPLACE

### ui/projects.js

<!-- B14: Persian board names survive export -->

<<<<<<< SEARCH
      options: { defaultPath: `${p.name.replace(/[^\w\- ]+/g, "").trim() || "board"}.bloom`, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
=======
      options: { defaultPath: `${p.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "board"}.bloom`, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
>>>>>>> REPLACE

---

## ui/ai.js

### ui/ai.js

<!-- B7: list-marker stripping must not eat words, and [S#] numbering must match the click handler -->

<<<<<<< SEARCH
  const script = blocks
    .map((b, i) => `${b.card.type === "hook" ? "HOOK" : `S${i}`}: ${b.card.text}`)
    .join("\n");
=======
  // the [S#] buttons index script-only blocks, so number the same way
  let ordinal = 0;
  const script = blocks
    .map((b) => {
      if (b.card.type === "hook") return `HOOK: ${b.card.text}`;
      ordinal += 1;
      return `S${ordinal}: ${b.card.text}`;
    })
    .join("\n");
>>>>>>> REPLACE

<<<<<<< SEARCH
  const lines = text.split("\n").map((l) => l.replace(/^\s*[-*\d.\[\]S]+\s*/, "").trim()).filter(Boolean);
=======
  // strip list markers only: the old class ate "Stop" -> "top" and "10 ways" -> "ways"
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*\u2022]|\d+[.)]|\[S\d+\])\s+/, "").trim())
    .filter(Boolean);
>>>>>>> REPLACE

<<<<<<< SEARCH
    critique: `Critique retention. Name the exact block where viewers are most likely to leave and why, as short lines that begin with [S1], [S2] and so on.\n\n${pack.text}`,
=======
    critique: `Critique retention. Name the exact block where viewers are most likely to leave and why, as short lines that begin with [S1], [S2] and so on, where S1 is the first numbered section of the script path.\n\n${pack.text}`,
>>>>>>> REPLACE

---

## ui/palette.js

### ui/palette.js

<!-- B16: arrow keys skip group headers -->

<<<<<<< SEARCH
export function movePaletteActive(delta) {
  if (!rows.length) return;
  active = (active + delta + rows.length) % rows.length;
  paintActive();
}
=======
export function movePaletteActive(delta) {
  if (!rows.length) return;
  // a group header is not selectable
  let next = active;
  for (let i = 0; i < rows.length; i++) {
    next = (next + delta + rows.length) % rows.length;
    if (rows[next].kind !== "group") break;
  }
  active = next;
  paintActive();
}
>>>>>>> REPLACE

<<<<<<< SEARCH
export function runPaletteActive() {
  const row = rows[active];
  if (!row) return;
=======
export function runPaletteActive() {
  const row = rows[active];
  if (!row || row.kind === "group") return;
>>>>>>> REPLACE

<<<<<<< SEARCH
  if (opts.mode === "connect") rows = rows.filter((r) => r.kind !== "group");
  active = Math.min(active, Math.max(0, rows.length - 1));
=======
  if (opts.mode === "connect") rows = rows.filter((r) => r.kind !== "group");
  active = Math.min(active, Math.max(0, rows.length - 1));
  if (rows[active]?.kind === "group") {
    const first = rows.findIndex((r) => r.kind !== "group");
    if (first >= 0) active = first;
  }
>>>>>>> REPLACE

---

## ui/settings.js

### ui/settings.js

<!-- B9: WPM reaches the board row, and snap can be turned off -->

<<<<<<< SEARCH
    await saveSettings(next);
    state.wpm = next.wpm;
    state.snap = next.snapDefault || state.snap;
=======
    await saveSettings(next);
    state.wpm = next.wpm;
    // the board row keeps its own wpm; without this the change is lost on reload
    markWpmDirty();
    state.snap = next.snapDefault;
>>>>>>> REPLACE

<<<<<<< SEARCH
import { settings, saveSettings, invoke, state } from "./store.js";
=======
import { settings, saveSettings, invoke, state, markWpmDirty } from "./store.js";
>>>>>>> REPLACE

---

## ui/style.css

### ui/style.css

<!-- C1: the drawer slides in from the correct side in RTL -->

<<<<<<< SEARCH
  transform: translateX(16px);
  opacity: 0;
  transition: transform 160ms ease-out, opacity 160ms ease-out;
  z-index: 45;
}
.drawer.is-open { transform: translateX(0); opacity: 1; }
=======
  transform: translateX(16px);
  opacity: 0;
  transition: transform 160ms ease-out, opacity 160ms ease-out;
  z-index: 45;
}
.drawer.is-open { transform: translateX(0); opacity: 1; }

html[dir="rtl"] .drawer {
  transform: translateX(-16px);
}

html[dir="rtl"] .drawer.is-open {
  transform: translateX(0);
}
>>>>>>> REPLACE

---

## src-tauri/src/ai.rs

Note: the source writes that header as `format!("x-api-key: {key}")`; the tool that produced CODE.md redacts the
interpolation as `***`. The SEARCH blocks below quote it as `{key}` — substitute the literal from the repo if your
copy shows asterisks.

### src-tauri/src/ai.rs

<!-- A7: temp body file + `-K -`, so the key never appears in argv -->

<<<<<<< SEARCH
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
=======
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
>>>>>>> REPLACE

### src-tauri/src/ai.rs

<!-- B8: ai_test must read the model the frontend actually saves -->

<<<<<<< SEARCH
    conn.query_row("SELECT value FROM settings WHERE key = 'ai.model'", [], |r| r.get::<_, String>(0))
        .optional()
=======
    // the frontend writes "model"; older builds used "ai.model"
    conn.query_row(
        "SELECT value FROM settings WHERE key IN ('model', 'ai.model') ORDER BY key = 'model' DESC LIMIT 1",
        [],
        |r| r.get::<_, String>(0),
    )
        .optional()
>>>>>>> REPLACE

### src-tauri/src/ai.rs

<!-- A7: one place builds the curl config, one place writes the body -->

<<<<<<< SEARCH
fn run_curl(key: &str, body: &Value) -> Result<std::process::Output, String> {
    let mut command = Command::new("curl.exe");
    command
        .args([
            "-sS",
            "--max-time",
            "90",
            "-H",
            "content-type: application/json",
            "-H",
            &format!("x-api-key: {key}"),
            "-H",
            "anthropic-version: 2023-06-01",
            "-d",
            &body.to_string(),
            API_URL,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().map_err(|e| format!("run curl: {e}"))
}
=======
/// Body on disk, headers on stdin: argv is visible to every process on the box.
fn write_temp_body(body: &Value) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("bloom-ai-{}-{nanos}.json", std::process::id()));
    std::fs::write(&path, body.to_string()).map_err(|e| format!("temp body: {e}"))?;
    Ok(path)
}

fn curl_config(key: &str, body_path: &Path) -> String {
    let body = body_path.to_string_lossy().replace('\\', "\\\\");
    format!(
        "header = \"x-api-key: {key}\"\nheader = \"content-type: application/json\"\n\
         header = \"anthropic-version: 2023-06-01\"\ndata-binary = \"@{body}\"\n"
    )
}

fn spawn_curl() -> Command {
    let mut command = Command::new("curl.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn run_curl(key: &str, body: &Value) -> Result<std::process::Output, String> {
    let body_path = write_temp_body(body)?;
    let config = curl_config(key, &body_path);
    let mut command = spawn_curl();
    command.args(["-sS", "--max-time", "90", "-K", "-", API_URL]);
    let mut child = command.spawn().map_err(|e| format!("run curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .map_err(|e| format!("curl config: {e}"))?;
    } // stdin drops here: curl sees EOF and starts
    let out = child.wait_with_output().map_err(|e| format!("run curl: {e}"))?;
    let _ = std::fs::remove_file(&body_path);
    Ok(out)
}
>>>>>>> REPLACE

### src-tauri/src/ai.rs

<!-- A7: ai_test is async, the blocking curl moves off the UI thread -->

<<<<<<< SEARCH
#[tauri::command]
pub fn ai_test(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
    let model = model_of(&conn);
    drop(conn);
    let key = secrets::get_key().ok_or("no API key saved")?;
    let body = json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{ "role": "user", "content": "Reply with the single word: ready" }]
    });
    let output = run_curl(&key, &body)?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(json!({ "ok": true, "reply": text.chars().take(200).collect::<String>() }))
    } else {
        Ok(json!({ "ok": false, "error": friendly(&text, output.status.code()) }))
    }
}

fn friendly(body: &str, code: Option<i32>) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    match code {
        Some(401) => "The API key was rejected. Check it in Settings.".into(),
        Some(429) => "Anthropic is rate limiting requests. Try again in a moment.".into(),
        Some(0) | None => "Could not reach Anthropic. Check the network and try again.".into(),
        Some(c) => format!("Anthropic returned HTTP {c}."),
    }
}
=======
#[tauri::command]
pub async fn ai_test(state: State<'_, AppState>) -> Result<Value, String> {
    let model = {
        let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
        model_of(&conn)
    };
    let key = secrets::get_key().ok_or("no API key saved")?;
    let body = json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{ "role": "user", "content": "Reply with the single word: ready" }]
    });
    let output = tauri::async_runtime::spawn_blocking(move || run_curl(&key, &body))
        .await
        .map_err(|e| e.to_string())??;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(json!({ "ok": true, "reply": text.chars().take(200).collect::<String>() }))
    } else {
        Ok(json!({ "ok": false, "error": friendly(&text) }))
    }
}

/// curl exits 0 for HTTP errors, so the body is the only source of truth here.
fn friendly(body: &str) -> String {
    let trimmed = body.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    if trimmed.is_empty() {
        return "Could not reach Anthropic. Check the network and try again.".into();
    }
    trimmed.chars().take(300).collect()
}
>>>>>>> REPLACE

### src-tauri/src/ai.rs

<!-- A7: close curl's stdin, and surface API errors that arrive without SSE -->

<<<<<<< SEARCH
    let mut command = Command::new("curl.exe");
    command
        .args([
            "-sS",
            "-N",
            "--max-time",
            "180",
            "-H",
            "content-type: application/json",
            "-H",
            &format!("x-api-key: {key}"),
            "-H",
            "anthropic-version: 2023-06-01",
            "--data-binary",
            "@-",
            API_URL,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("run curl: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(body.to_string().as_bytes()).map_err(|e| e.to_string())?;
    }
=======
    let body_path = write_temp_body(&body)?;
    let config = curl_config(&key, &body_path);
    let mut command = spawn_curl();
    command.args(["-sS", "-N", "--max-time", "180", "-K", "-", API_URL]);
    let mut child = command.spawn().map_err(|e| format!("run curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .map_err(|e| format!("curl config: {e}"))?;
    } // holding the pipe open was the bug: curl waited for EOF until --max-time
>>>>>>> REPLACE

<<<<<<< SEARCH
        let reader = BufReader::new(stdout);
        let mut text = String::new();
        let mut failed: Option<String> = None;
        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    break;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(err) = v.get("error") {
                        failed = Some(err.get("message").and_then(|m| m.as_str()).unwrap_or("request failed").to_string());
                        break;
                    }
                    if let Some(delta) = v
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                    {
                        text.push_str(delta);
                        let _ = app2.emit("ai://chunk", json!({"requestId": rid, "text": delta}));
                    }
                    if v.get("type").and_then(|t| t.as_str()) == Some("message_stop") {
                        break;
                    }
                }
            }
        }
        let status = child.wait().ok().and_then(|s| s.code());
        match failed {
            Some(err) => {
                let _ = app2.emit("ai://error", json!({"requestId": rid, "error": friendly(&err, status)}));
            }
            None => {
                let _ = app2.emit("ai://done", json!({"requestId": rid, "text": text, "code": status}));
            }
        }
=======
        let _ = std::fs::remove_file(&body_path);
        let reader = BufReader::new(stdout);
        let mut text = String::new();
        let mut failed: Option<String> = None;
        // rejected requests come back as plain JSON, not as SSE lines
        let mut other = String::new();
        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    break;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(err) = v.get("error") {
                        failed = Some(err.get("message").and_then(|m| m.as_str()).unwrap_or("request failed").to_string());
                        break;
                    }
                    if let Some(delta) = v
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                    {
                        text.push_str(delta);
                        let _ = app2.emit("ai://chunk", json!({"requestId": rid, "text": delta}));
                    }
                    if v.get("type").and_then(|t| t.as_str()) == Some("message_stop") {
                        break;
                    }
                }
            } else {
                other.push_str(&line);
                other.push('\n');
            }
        }
        let status = child.wait().ok().and_then(|s| s.code());
        // no streamed text and no SSE error: the body is an API error, not an answer
        if failed.is_none() && text.is_empty() && !other.trim().is_empty() {
            failed = Some(friendly(&other));
        }
        match failed {
            Some(err) => {
                let _ = app2.emit("ai://error", json!({"requestId": rid, "error": friendly(&err)}));
            }
            None => {
                let _ = app2.emit("ai://done", json!({"requestId": rid, "text": text, "code": status}));
            }
        }
>>>>>>> REPLACE

---

## src-tauri/src/commands.rs

### src-tauri/src/commands.rs

<!-- A8: no cmd.exe in the URL path, and open_folder only takes folders -->

<<<<<<< SEARCH
fn shell_open(target: &str) -> Result<(), String> {
    let mut command = Command::new("cmd.exe");
    command.args(["/C", "start", "", target]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("open: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http and https links can be opened".into());
    }
    shell_open(&url)
}
=======
/// Launches one program with an argument list — never through a shell, so a
/// `&` or `|` inside the argument cannot become a second command.
fn spawn_detached(exe: &str, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new(exe);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("open: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http and https links can be opened".into());
    }
    if url.chars().any(|c| c.is_control()) {
        return Err("link contains control characters".into());
    }
    spawn_detached("rundll32.exe", &["url.dll,FileProtocolHandler", &url])
}
>>>>>>> REPLACE

<<<<<<< SEARCH
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("folder does not exist".into());
    }
    shell_open(&path)
}
=======
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    // a file path here used to launch whatever the caller pointed at
    if !p.is_dir() {
        return Err("folder does not exist".into());
    }
    spawn_detached("explorer.exe", &[&path])
}
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A8: the title fetch stays on http(s), even through redirects -->

<<<<<<< SEARCH
        .args([
            "-sS",
            "-L",
            "--max-redirs",
            "3",
            "--max-time",
            "5",
=======
        .args([
            "-sS",
            "-L",
            "--proto",
            "=http,https",
            "--proto-redir",
            "=http,https",
            "--max-redirs",
            "3",
            "--max-time",
            "5",
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A10: decide on a snapshot before reading the board, and prune old ones -->

<<<<<<< SEARCH
    let snapshotted = if touched > 0 {
        let board = crate::store::read_board(&conn, &project_id)?.unwrap_or(Value::Null);
        maybe_snapshot(&conn, &project_id, &board, "autosave")?
    } else {
        false
    };
=======
    // reading the whole board on every keystroke was the cost; ask first
    let snapshotted = if touched > 0 && snapshot_due(&conn, &project_id)? {
        let board = crate::store::read_board(&conn, &project_id)?.unwrap_or(Value::Null);
        maybe_snapshot(&conn, &project_id, &board, "autosave")?
    } else {
        false
    };
>>>>>>> REPLACE

<<<<<<< SEARCH
fn maybe_snapshot(
    conn: &Connection,
    project_id: &str,
    board: &Value,
    label: &str,
) -> Result<bool, String> {
    if board.is_null() {
        return Ok(false);
    }
    let newest: Option<i64> = conn
        .query_row(
            "SELECT MAX(created_at) FROM snapshots WHERE project_id = ?1",
            params![project_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let now = now_ms();
    if newest.map(|t| now - t > SNAPSHOT_INTERVAL_MS).unwrap_or(true) {
        insert_snapshot(conn, project_id, label, &board.to_string())?;
        return Ok(true);
    }
    Ok(false)
}
=======
fn snapshot_due(conn: &Connection, project_id: &str) -> Result<bool, String> {
    let newest: Option<i64> = conn
        .query_row(
            "SELECT MAX(created_at) FROM snapshots WHERE project_id = ?1",
            params![project_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    Ok(newest
        .map(|t| now_ms() - t > SNAPSHOT_INTERVAL_MS)
        .unwrap_or(true))
}

fn maybe_snapshot(
    conn: &Connection,
    project_id: &str,
    board: &Value,
    label: &str,
) -> Result<bool, String> {
    if board.is_null() {
        return Ok(false);
    }
    if !snapshot_due(conn, project_id)? {
        return Ok(false);
    }
    insert_snapshot(conn, project_id, label, &board.to_string())?;
    Ok(true)
}
>>>>>>> REPLACE

<<<<<<< SEARCH
    conn.execute(
        "INSERT INTO snapshots (id, project_id, label, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![sid, project_id, label, payload, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(sid)
}
=======
    conn.execute(
        "INSERT INTO snapshots (id, project_id, label, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![sid, project_id, label, payload, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    // keep the newest 50 plus one per day for a fortnight
    conn.execute(
        "DELETE FROM snapshots
          WHERE project_id = ?1
            AND id NOT IN (
              SELECT id FROM snapshots WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 50
            )
            AND id NOT IN (
              SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                         PARTITION BY strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')
                         ORDER BY created_at DESC
                       ) AS rn
                  FROM snapshots
                 WHERE project_id = ?1 AND created_at > ?2
              ) WHERE rn = 1
            )",
        params![project_id, now_ms() - 14 * 24 * 3600 * 1000],
    )
    .map_err(|e| e.to_string())?;
    Ok(sid)
}
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A11: duplicating a board copies its attachment rows, it does not move them -->

<<<<<<< SEARCH
    let conn = lock_db(&state)?;
    let mut board = crate::store::read_board(&conn, &id)?.ok_or("project not found")?;
    remap_board_ids(&mut board);
    let copy_id = new_id("p");
    let original_name = board.get("name").and_then(|v| v.as_str()).unwrap_or("Board");
    let name = name.unwrap_or_else(|| format!("{original_name} copy"));
    conn.execute(
        "INSERT INTO projects (id, name, status, tags, created_at, updated_at, viewport, wpm)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
        params![
            copy_id,
            name,
            board.get("status").and_then(|v| v.as_str()).unwrap_or("Spark"),
            board.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
            now_ms(),
            board.get("viewport").cloned().unwrap_or(json!({})).to_string(),
            board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150),
        ],
    )
    .map_err(|e| e.to_string())?;
    crate::store::write_board(&conn, &copy_id, &board)?;
    conn.execute(
        "UPDATE attachments SET project_id = ?1 WHERE project_id = ?2",
        params![copy_id, id],
    )
    .map_err(|e| e.to_string())?;
    project_row(&conn, &copy_id)?.ok_or_else(|| "duplicate vanished".into())
=======
    let mut conn = lock_db(&state)?;
    let mut board = crate::store::read_board(&conn, &id)?.ok_or("project not found")?;
    remap_board_ids(&mut board);
    let copy_id = new_id("p");
    let original_name = board.get("name").and_then(|v| v.as_str()).unwrap_or("Board");
    let name = name.unwrap_or_else(|| format!("{original_name} copy"));
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO projects (id, name, status, tags, created_at, updated_at, viewport, wpm)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
            params![
                copy_id,
                name,
                board.get("status").and_then(|v| v.as_str()).unwrap_or("Spark"),
                board.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
                now_ms(),
                board.get("viewport").cloned().unwrap_or(json!({})).to_string(),
                board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150),
            ],
        )
        .map_err(|e| e.to_string())?;
        crate::store::write_board(&tx, &copy_id, &board)?;
        // the original keeps its rows: this used to be an UPDATE that moved them
        let mut stmt = tx
            .prepare(
                "SELECT card_id, file_name, mime, w, h, hash, bytes
                   FROM attachments WHERE project_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<i64>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        for (card_id, file_name, mime, w, h, hash, bytes) in rows {
            tx.execute(
                "INSERT INTO attachments (id, project_id, card_id, file_name, mime, w, h, hash, bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![new_id("a"), copy_id, card_id, file_name, mime, w, h, hash, bytes],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    project_row(&conn, &copy_id)?.ok_or_else(|| "duplicate vanished".into())
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A11: a seeded project is created in one transaction -->

<<<<<<< SEARCH
    let conn = lock_db(&state)?;
    let pid = new_id("p");
    let seed_name = seed
=======
    let mut conn = lock_db(&state)?;
    let pid = new_id("p");
    let seed_name = seed
>>>>>>> REPLACE

<<<<<<< SEARCH
    conn.execute(
        "INSERT INTO projects (id, name, status, created_at, updated_at, viewport, wpm)
         VALUES (?1, ?2, ?3, ?4, ?4, '{}', 150)",
        params![pid, name, status, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    if let Some(mut board) = seed {
        remap_board_ids(&mut board);
        board["projectId"] = Value::String(pid.clone());
        crate::store::write_board(&conn, &pid, &board)?;
    }
    project_row(&conn, &pid)?.ok_or_else(|| "project vanished".into())
=======
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO projects (id, name, status, created_at, updated_at, viewport, wpm)
             VALUES (?1, ?2, ?3, ?4, ?4, '{}', 150)",
            params![pid, name, status, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        if let Some(mut board) = seed {
            remap_board_ids(&mut board);
            board["projectId"] = Value::String(pid.clone());
            crate::store::write_board(&tx, &pid, &board)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    project_row(&conn, &pid)?.ok_or_else(|| "project vanished".into())
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A11: restoring a snapshot writes atomically -->

<<<<<<< SEARCH
    let conn = lock_db(&state)?;
    let (project_id, payload): (String, String) = conn
        .query_row(
            "SELECT project_id, payload FROM snapshots WHERE id = ?1",
            params![snapshot_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if let Some(current) = crate::store::read_board(&conn, &project_id)? {
        let _ = insert_snapshot(&conn, &project_id, "before restore", &current.to_string());
    }
    let board: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    crate::store::write_board(&conn, &project_id, &board)?;
    Ok(board)
=======
    let mut conn = lock_db(&state)?;
    let (project_id, payload): (String, String) = conn
        .query_row(
            "SELECT project_id, payload FROM snapshots WHERE id = ?1",
            params![snapshot_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let board: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if let Some(current) = crate::store::read_board(&tx, &project_id)? {
            let _ = insert_snapshot(&tx, &project_id, "before restore", &current.to_string());
        }
        crate::store::write_board(&tx, &project_id, &board)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(board)
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A12: only real attachments/<hex>.<ext> paths are read or exported -->

<<<<<<< SEARCH
fn referenced_attachments(board: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(cards) = board.get("cards").and_then(|c| c.as_array()) {
        for c in cards {
            if let Some(src) = c
                .get("image")
                .and_then(|i| i.get("src"))
                .and_then(|s| s.as_str())
            {
                if !out.iter().any(|s: &String| s == src) {
                    out.push(src.to_string());
                }
            }
        }
    }
    out
}
=======
/// `image.src` comes from board.json, so it is untrusted: accept only
/// attachments/<hex>.<known extension>, never a path with separators.
fn safe_attachment_src(src: &str) -> Option<String> {
    let rest = src.strip_prefix("attachments/")?;
    if rest.contains('/') || rest.contains('\\') || rest.contains("..") {
        return None;
    }
    let (stem, ext) = rest.rsplit_once('.')?;
    if stem.len() < 16 || !stem.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    if !["png", "jpg", "jpeg", "webp", "gif", "avif"].contains(&ext.to_lowercase().as_str()) {
        return None;
    }
    Some(format!("attachments/{rest}"))
}

fn referenced_attachments(board: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(cards) = board.get("cards").and_then(|c| c.as_array()) {
        for c in cards {
            if let Some(src) = c
                .get("image")
                .and_then(|i| i.get("src"))
                .and_then(|s| s.as_str())
            {
                if let Some(safe) = safe_attachment_src(src) {
                    if !out.iter().any(|s: &String| s == &safe) {
                        out.push(safe);
                    }
                }
            }
        }
    }
    out
}
>>>>>>> REPLACE

<<<<<<< SEARCH
    let mut board: Value = serde_json::from_str(&board_json).map_err(|e| format!("bad board.json: {e}"))?;
    remap_board_ids(&mut board);

    let data = crate::data_dir(&app);
=======
    let mut board: Value = serde_json::from_str(&board_json).map_err(|e| format!("bad board.json: {e}"))?;
    remap_board_ids(&mut board);
    // drop image references that do not point inside attachments/
    if let Some(cards) = board.get_mut("cards").and_then(|c| c.as_array_mut()) {
        for card in cards.iter_mut() {
            let invalid = card
                .get("image")
                .and_then(|i| i.get("src"))
                .and_then(|s| s.as_str())
                .map(|src| safe_attachment_src(src).is_none())
                .unwrap_or(false);
            if invalid {
                if let Some(obj) = card.as_object_mut() {
                    obj.remove("image");
                }
            }
        }
    }

    let data = crate::data_dir(&app);
>>>>>>> REPLACE

### src-tauri/src/commands.rs

<!-- A11: the imported project rows land in one transaction -->

<<<<<<< SEARCH
    let conn = lock_db(&state)?;
    let pid = new_id("p");
    let name = board
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported board")
        .to_string();
    conn.execute(
        "INSERT INTO projects (id, name, status, tags, created_at, updated_at, viewport, wpm)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
        params![
            pid,
            name,
            board.get("status").and_then(|v| v.as_str()).unwrap_or("Spark"),
            board.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
            now_ms(),
            board.get("viewport").cloned().unwrap_or(json!({})).to_string(),
            board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150),
        ],
    )
    .map_err(|e| e.to_string())?;
    crate::store::write_board(&conn, &pid, &board)?;

    for src in referenced_attachments(&board) {
        let file = src.trim_start_matches("attachments/").to_string();
        let hash = file.split('.').next().unwrap_or("").to_string();
        conn.execute(
            "INSERT INTO attachments (id, project_id, file_name, mime, hash)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![crate::new_id("a"), pid, file, "", hash],
        )
        .map_err(|e| e.to_string())?;
    }

    project_row(&conn, &pid)?.ok_or_else(|| "imported project vanished".into())
=======
    let mut conn = lock_db(&state)?;
    let pid = new_id("p");
    let name = board
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported board")
        .to_string();
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO projects (id, name, status, tags, created_at, updated_at, viewport, wpm)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
            params![
                pid,
                name,
                board.get("status").and_then(|v| v.as_str()).unwrap_or("Spark"),
                board.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
                now_ms(),
                board.get("viewport").cloned().unwrap_or(json!({})).to_string(),
                board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150),
            ],
        )
        .map_err(|e| e.to_string())?;
        crate::store::write_board(&tx, &pid, &board)?;

        for src in referenced_attachments(&board) {
            let file = src.trim_start_matches("attachments/").to_string();
            let hash = file.split('.').next().unwrap_or("").to_string();
            tx.execute(
                "INSERT INTO attachments (id, project_id, file_name, mime, hash)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![crate::new_id("a"), pid, file, "", hash],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    project_row(&conn, &pid)?.ok_or_else(|| "imported project vanished".into())
>>>>>>> REPLACE

---

## src-tauri/src/lib.rs

### src-tauri/src/lib.rs

<!-- A9: state first, physical pixels, no off-screen restore, one write per quiet period -->

<<<<<<< SEARCH
static LAUNCH_FILE: Mutex<Option<String>> = Mutex::new(None);
=======
static LAUNCH_FILE: Mutex<Option<String>> = Mutex::new(None);

/// Coalesced window geometry: events only record, a worker writes.
#[derive(Clone, Copy, Default)]
struct RectPatch {
    size: Option<(u32, u32)>,
    pos: Option<(i32, i32)>,
    at: Option<std::time::Instant>,
}
type PendingRect = std::sync::Arc<Mutex<Option<RectPatch>>>;
>>>>>>> REPLACE

<<<<<<< SEARCH
            if let Some(window) = app.get_webview_window("main") {
                let w = read_setting(&conn, "window.w").and_then(|v| v.parse::<f64>().ok());
                let h = read_setting(&conn, "window.h").and_then(|v| v.parse::<f64>().ok());
                if let (Some(w), Some(h)) = (w, h) {
                    let _ = window.set_size(tauri::LogicalSize::new(w.max(900.0), h.max(600.0)));
                }
                let x = read_setting(&conn, "window.x").and_then(|v| v.parse::<f64>().ok());
                let y = read_setting(&conn, "window.y").and_then(|v| v.parse::<f64>().ok());
                if let (Some(x), Some(y)) = (x, y) {
                    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                }
                let events = handle.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Resized(size) => {
                        let state: tauri::State<AppState> = events.state();
                        if let Ok(conn) = state.db.lock() {
                            write_setting(&conn, "window.w", &size.width.to_string());
                            write_setting(&conn, "window.h", &size.height.to_string());
                        };
                    }
                    tauri::WindowEvent::Moved(pos) => {
                        let state: tauri::State<AppState> = events.state();
                        if let Ok(conn) = state.db.lock() {
                            write_setting(&conn, "window.x", &pos.x.to_string());
                            write_setting(&conn, "window.y", &pos.y.to_string());
                        };
                    }
                    _ => {}
                });
            }

            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
            });
=======
            let saved = (
                read_setting(&conn, "window.w").and_then(|v| v.parse::<f64>().ok()),
                read_setting(&conn, "window.h").and_then(|v| v.parse::<f64>().ok()),
                read_setting(&conn, "window.x").and_then(|v| v.parse::<f64>().ok()),
                read_setting(&conn, "window.y").and_then(|v| v.parse::<f64>().ok()),
            );

            // manage before any handler can call state(): a Resized event that
            // arrived first used to panic the app
            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
            });

            if let Some(window) = app.get_webview_window("main") {
                // events report physical pixels; restoring them as logical made
                // the window grow on every launch on a scaled display
                if let (Some(w), Some(h)) = (saved.0, saved.1) {
                    let _ = window.set_size(tauri::PhysicalSize::new(w.max(600.0), h.max(400.0)));
                }
                if let (Some(x), Some(y)) = (saved.2, saved.3) {
                    // a minimised window reports (-32000, -32000)
                    if x > -10000.0 && y > -10000.0 {
                        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                    }
                }

                let pending: PendingRect = std::sync::Arc::new(Mutex::new(None));
                let slot = pending.clone();
                window.on_window_event(move |event| {
                    let mut guard = match slot.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    match event {
                        tauri::WindowEvent::Resized(size) => {
                            let mut next = guard.take().unwrap_or_default();
                            next.size = Some((size.width, size.height));
                            next.at = Some(std::time::Instant::now());
                            *guard = Some(next);
                        }
                        tauri::WindowEvent::Moved(pos) => {
                            if pos.x < -10000 || pos.y < -10000 {
                                return;
                            }
                            let mut next = guard.take().unwrap_or_default();
                            next.pos = Some((pos.x, pos.y));
                            next.at = Some(std::time::Instant::now());
                            *guard = Some(next);
                        }
                        _ => {}
                    }
                });

                let events = handle.clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    let ready = {
                        let mut guard = match pending.lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        let due = guard
                            .as_ref()
                            .and_then(|r| r.at)
                            .map(|at| at.elapsed().as_millis() >= 500)
                            .unwrap_or(false);
                        if due {
                            guard.take()
                        } else {
                            None
                        }
                    };
                    let Some(rect) = ready else { continue };
                    let state: tauri::State<AppState> = events.state();
                    // bind the guard first: an if-let scrutinee would outlive `state`
                    let locked = state.db.lock();
                    if let Ok(conn) = locked {
                        if let Some((w, h)) = rect.size {
                            write_setting(&conn, "window.w", &w.to_string());
                            write_setting(&conn, "window.h", &h.to_string());
                        }
                        if let Some((x, y)) = rect.pos {
                            write_setting(&conn, "window.x", &x.to_string());
                            write_setting(&conn, "window.y", &y.to_string());
                        }
                    }
                });
            }
>>>>>>> REPLACE

### src-tauri/src/lib.rs

<!-- B13: HTML5 drag events need the native handler out of the way -->

<<<<<<< SEARCH
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
=======
        .plugin(tauri_plugin_dialog::init())
>>>>>>> REPLACE

---

## src-tauri/Cargo.toml

### src-tauri/Cargo.toml

<!-- B13: the fs plugin is unused -->

<<<<<<< SEARCH
tauri-plugin-fs = "2"
=======
>>>>>>> REPLACE

---

## src-tauri/tauri.conf.json

### src-tauri/tauri.conf.json

<!-- B13: let the webview own drag and drop -->

<<<<<<< SEARCH
        "decorations": true,
        "backgroundColor": "#121211"
=======
        "decorations": true,
        "backgroundColor": "#121211",
        "dragDropEnabled": false
>>>>>>> REPLACE

---

## VERIFY

- A1: keep typing while a save is in flight (slow disk): the last characters survive a reload; the badge only reads “Saved” once nothing is pending.
- A2: create a card, Ctrl+Z, reload — the card stays gone (before: it came back).
- A3: New board → Tutorial, edit a card, reload: one copy of each card; DB row count equals the board count.
- A4: More → Import .bloom shows one picker and opens the imported board with its cards.
- A5: open board A, B, back to A; press Enter in a script block — one new block, not three.
- A6: select two cards, Ctrl+C, click empty space, Ctrl+V — pasted at the pointer; Ctrl+D duplicates without changing what Ctrl+V pastes; Ctrl+C with nothing selected keeps the old clipboard.
- A7: wrong key → the panel shows the API message rather than an empty answer; no `x-api-key` in the curl command line; a 401 returns immediately instead of at 90 s.
- A8: a Source URL containing `&calc` only opens the browser; Open backups refuses a file path; title fetch cannot follow a redirect to `file://`.
- A9: 150 % scaling, resize, restart twice — size is stable; minimise, quit, relaunch — window is on screen; dragging does not write per event (log tail).
- A10: typing reads the board only when the interval has elapsed (`snapshotted=false` most saves); snapshots table stays bounded.
- A11: duplicate a board holding an image — the original still shows it; kill the app mid-import — no half-written project.
- A12: edit board.json in a bundle to `"src": "../../../../Windows/win.ini"` — import drops the image and export never reads outside attachments/.
- B3: keep the type select open — it no longer closes; choosing “Hook” converts the card; selecting a vine shows a context bar.
- B4: edit in Script view, switch to Canvas — vines reattach; Enter adds the block below, not on top.
- B5: drag from a pin into empty space — the card appears at the drop point and the vine enters the facing side.
- B6: with Settings open, Delete leaves the selection alone; Space inside a number input does not pan.
- B7: insert “Stop doing this / 10 ways” — first letters survive; [S2] lands on the second script block.
- B8: choose a model, Test key — the chosen model is used.
- B9: change WPM, reload — runtime uses it; untick snap, reload — stays off; relaunch — last board opens.
- B10: teleprompter at speed 1 scrolls; Persian text runs right-to-left.
- B11: rows read “12 cards, edited 2 min ago”; Tab+Enter opens a row; ⋯ opens the menu without opening the board.
- B13: drop an image from Explorer on the canvas — Image card appears; drag a board between columns — status changes.
- B14: board “قانون سه ساعت” exports as `قانون سه ساعت.bloom`.
- B16: “a”, ArrowDown, Enter — never lands on the group header.
- C1: History in Persian slides in from the left.
- C2: Tab order follows the document; chrome reachable before cards.
- C3: toggling language repaints once.

## NOT A BUG / SKIPPED

- A5's “or call it once”: the idempotence guard is the smaller change; the call sites stay.
- A7 “ai_generate must not block”: the command only spawns the child; streaming already runs on its own thread. `fetch_page_title` remains synchronous — see UNFINISHED.
- B13 “remove tauri-plugin-fs”: it was still registered, so it is removed; capabilities had no fs permission already.

## UNFINISHED

- A7 (fetch_page_title made async), B1, B2, B3d (sticky fill), B12, B15, B17, B18, B19, B20, B21, B22, C4, C5.

## Remaining risks noticed, not changed

1. `savePass` serialises every upsert twice (once for `sent`, once for the payload); a 2 000-card burst pays for it.
2. The snapshot prune partitions by `strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')` — correct only while `now_ms()` is milliseconds.
3. `duplicate_project` lists attachment columns explicitly; a future migration must update that query.
4. The window-rect worker thread lives for the process and only reaches the DB through `state()`.
5. `open_url` still hands `https:` to the OS handler: a malicious `.bloom` can open a browser tab (expected, worth knowing).
