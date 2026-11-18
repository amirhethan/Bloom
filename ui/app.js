// Bloom — shell: chrome, hotkeys, context bar, pen popover, menus, boot.

import * as store from "./store.js";
import * as engine from "./engine.js";
import { openPalette, closePalette, paletteOpen, runPaletteActive, movePaletteActive, paletteContext, initPalette, ADD_ITEMS } from "./palette.js";
import { initScript, renderScript, markScriptDirty, exportScript, openTeleprompter, createBlockAfter, removeBlock } from "./script.js";
import { initProjects, renderProjects, openProject, newBoard } from "./projects.js";
import { initHistory, toggleHistory, historyOpen, renderHistory } from "./history.js";
import { initAi, toggleAi, aiOpen } from "./ai.js";
import { openSettings } from "./settings.js";
import { toast, errorToast, openModal, closeModal, menu, closeMenu, menuOpen, cheatSheet, showHints, refreshHints, modalOpen } from "./overlay.js";
import { ingestFiles, pickImage, blobFromClipboard, setCardImage } from "./media.js";
import { t, num, setLocale, getLocale, localeFromStorage, onLocaleChange, applyStatic } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let screen = "canvas";
let info = null;

/* ───────────────────────── chrome ───────────────────────── */

function paintChrome() {
  const name = store.state.name || "Untitled board";
  const nameEl = $("#project-name");
  if (nameEl && nameEl.textContent !== name && !nameEl.contains(document.activeElement)) nameEl.textContent = name;
  const langBtn = $("#lang-btn .lang-btn-text");
  if (langBtn) langBtn.textContent = getLocale() === "fa" ? "EN" : "فا";
  const pill = $("#status-pill");
  if (pill) {
    pill.textContent = t(`status.${store.state.status}`);
    pill.classList.toggle("is-spark", store.state.status === "Spark");
  }
  $("#zoom-btn").textContent = `${num(Math.round(store.state.viewport.zoom * 100))}%`;
  $("#snap-indicator").hidden = !store.state.snap;
  $("#screen-canvas").classList.toggle("is-connect", Boolean(paletteContext()?.connect));
}

store.onSaveState((status, detail) => {
  const el = $("#save-state");
  if (!el) return;
  el.dataset.state = status;
  const label = el.querySelector(".save-label");
  if (status === "saving") label.textContent = t("app.saving");
  else if (status === "error") label.textContent = t("app.saveError");
  else label.textContent = t("app.saved");
  el.title = status === "error" ? t("app.retryHint") : detail?.bytes ? `${num(detail.bytes)} B` : t("app.saveTitle");
});

function goto(name) {
  screen = name;
  for (const id of ["start", "canvas", "script"]) $(`#screen-${id}`).hidden = id !== name;
  $$("[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  if (name === "canvas") {
    engine.applyTransform();
    engine.renderMinimap();
  }
  if (name === "script") {
    markScriptDirty();
    renderScript();
  }
  if (name === "start") renderProjects();
  paintChrome();
}

/* ───────────────────────── command bar ───────────────────────── */

function openAdd(seed = "", connect = null) {
  openPalette({
    mode: "add",
    seed,
    connect,
    onAdd: (type, connection) => addThing(type, connection),
    onDraw: () => setTool("pen"),
    onFocus: (id) => {
      engine.focusCard(id);
      updateContextBar();
    },
  });
}

function openSearch() {
  openPalette({
    mode: "search",
    onAdd: (type) => addThing(type),
    onDraw: () => setTool("pen"),
    onFocus: (id) => engine.focusCard(id),
  });
}

function addThing(type, connection) {
  if (type === "frame") {
    engine.insertFrame();
    return;
  }
  const card = engine.insertCard(type);
  if (connection?.from && card) engine.connect(card.id, connection.from, connection.fromPin);
  updateContextBar();
}

/* ───────────────────────── tools ───────────────────────── */

function setTool(name) {
  engine.setTool(name);
  $$(".tool").forEach((b) => b.classList.toggle("is-active", b.dataset.tool === name));
  renderPenPopover(name);
}

const PEN_TOOLS = [
  { id: "pen", key: "pen.pen" },
  { id: "eraser", key: "pen.eraser" },
  { id: "rect", key: "pen.rect" },
  { id: "ellipse", key: "pen.ellipse" },
  { id: "arrow", key: "pen.arrow" },
];

function renderPenPopover(active) {
  const bar = $("#penbar");
  const penActive = PEN_TOOLS.some((item) => item.id === active);
  bar.hidden = !penActive;
  if (!penActive) return;
  const style = engine.getPen();
  bar.innerHTML = `${PEN_TOOLS.map((item) => {
    const label = t(item.key);
    return `<button class="pen-tool${item.id === active ? " is-active" : ""}" data-pen-tool="${item.id}" aria-label="${label}" title="${label}">${label}</button>`;
  }).join("")}
    <span class="pen-sep"></span>
    ${["pen", "text", "accent", "shot", "titles", "thumb"]
      .map((c) => `<button class="swatch${style.color === c ? " is-active" : ""}" data-pen-color="${c}" style="--swatch:var(--pen-${c === "pen" ? "default" : c})" aria-label="${c}"></button>`)
      .join("")}
    <span class="pen-sep"></span>
    ${[1.6, 3, 6]
      .map((w) => `<button class="pen-width${style.width === w ? " is-active" : ""}" data-pen-width="${w}" aria-label="${w}px"><span style="height:${w}px"></span></button>`)
      .join("")}`;
  bar.onclick = (e) => {
    const tool = e.target.closest("[data-pen-tool]")?.dataset.penTool;
    const color = e.target.closest("[data-pen-color]")?.dataset.penColor;
    const width = e.target.closest("[data-pen-width]")?.dataset.penWidth;
    if (tool) setTool(tool);
    if (color) {
      engine.setPen({ color });
      renderPenPopover(engine.getTool());
      engine.setTool(engine.getTool());
    }
    if (width) {
      engine.setPen({ width: Number(width) });
      renderPenPopover(engine.getTool());
    }
  };
}

/* ───────────────────────── context bar ───────────────────────── */

let ctxBound = false;

function updateContextBar() {
  const bar = $("#ctxbar");
  if (!bar) return;
  const box = engine.selectionBounds();
  const count = engine.selectionCount();
  if (!box || count === 0 || screen !== "canvas") {
    bar.hidden = true;
    return;
  }
  const screenBox = {
    x: box.x * store.state.viewport.zoom + store.state.viewport.x,
    y: box.y * store.state.viewport.zoom + store.state.viewport.y,
    w: box.w * store.state.viewport.zoom,
    h: box.h * store.state.viewport.zoom,
  };
  bar.hidden = false;
  bar.innerHTML = contextBarMarkup();
  bar.style.left = `${Math.round(screenBox.x + screenBox.w / 2)}px`;
  bar.style.top = `${Math.round(screenBox.y - 12)}px`;
  const r = bar.getBoundingClientRect();
  if (r.right > window.innerWidth - 12) bar.style.left = `${window.innerWidth - r.width / 2 - 12}px`;
  if (r.left < 12) bar.style.left = `${r.width / 2 + 12}px`;
  if (r.top < 70) bar.style.top = `${Math.round(screenBox.y + screenBox.h + 12 + r.height)}px`;
  if (!ctxBound) {
    bar.addEventListener("click", onContextClick);
    ctxBound = true;
  }
}

function contextBarMarkup() {
  const { sel } = store;
  const total = engine.selectionCount();
  const icon = (name, path) => `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${path}</svg>`;
  const btn = (act, title, path, extra = "") =>
    `<button class="ctx-btn${extra}" data-ctx="${act}" title="${title}" aria-label="${title}">${icon(title, path)}</button>`;
  const tb = (act, key, path, extra = "") => btn(act, t(key), path, extra);

  if (total === 1 && sel.cards.size === 1) {
    const card = store.cardById([...sel.cards][0]);
    const current = card.type;
    return `<label class="ctx-select" title="${t("ctx.type")}">
        <span class="dot" style="background:var(--tint-${store.TINTS[current]})"></span>
        <select data-type-switch>${[...store.CARD_TYPES, "thumbnail"]
          .filter((type, i, a) => a.indexOf(type) === i)
          .map((type) => `<option value="${type}"${type === current ? " selected" : ""}>${t(`type.${type}`)}</option>`)
          .join("")}</select>
      </label>
      ${current === "thumbnail" ? `<button class="ctx-btn ctx-text" data-ctx="set-image">${t("ctx.setImage")}</button>` : ""}
      ${current === "sticky" ? stickySwatches() : ""}
      ${tb("duplicate", "ctx.duplicate", '<path d="M9 9h10v10H9z"/><path d="M5 15V5h10"/>')}
      ${tb("connect", "ctx.connect", '<path d="M4 18c0-6 5-10 14-10"/><path d="M14 4l4 4-4 4"/>')}
      ${tb("delete", "ctx.delete", '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>')}`;
  }
  if (sel.vines.size === 1 && total === 1) {
    const v = store.vineById([...sel.vines][0]);
    return `<button class="ctx-btn ctx-text" data-ctx="vine-kind">${t(v.kind === "script" ? "ctx.removeScript" : "ctx.makeScript")}</button>
      ${tb("vine-label", "ctx.editLabel", '<path d="M4 20l1-4 11-11 3 3L8 19z"/><path d="M14 7l3 3"/>')}
      ${tb("delete", "ctx.delete", '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>')}`;
  }
  if (sel.frames.size === 1 && total === 1) {
    return `${tb("frame-label", "ctx.editLabel", '<path d="M4 20l1-4 11-11 3 3L8 19z"/><path d="M14 7l3 3"/>')}
      ${tb("delete", "ctx.delete", '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>')}`;
  }
  if ((sel.strokes.size || sel.shapes.size) && total <= 3) {
    return `${["pen", "text", "accent", "shot", "titles", "thumb"]
      .map((c) => `<button class="swatch" data-stroke-color="${c}" style="--swatch:var(--pen-${c === "pen" ? "default" : c})" aria-label="${c}"></button>`)
      .join("")}
      ${[1.6, 3, 6].map((w) => `<button class="pen-width" data-stroke-width="${w}" aria-label="${w}px"><span style="height:${w}px"></span></button>`).join("")}
      ${tb("delete", "ctx.delete", '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>')}`;
  }
  const alignPath = {
    left: '<path d="M4 4v16"/><path d="M8 8h10M8 16h6"/>',
    center: '<path d="M12 4v16"/><path d="M6 8h12M8 16h8"/>',
    right: '<path d="M20 4v16"/><path d="M6 8h10M10 16h6"/>',
    top: '<path d="M4 4h16"/><path d="M8 8v10M16 8v6"/>',
    middle: '<path d="M4 12h16"/><path d="M8 6v12M16 8v8"/>',
    bottom: '<path d="M4 20h16"/><path d="M8 6v10M16 10v6"/>',
  };
  const alignKey = { left: "ctx.alignLeft", center: "ctx.alignCenter", right: "ctx.alignRight", top: "ctx.alignTop", middle: "ctx.alignMiddle", bottom: "ctx.alignBottom" };
  return `${Object.entries(alignPath).map(([k, p]) => tb(`align-${k}`, alignKey[k], p)).join("")}
    <span class="pen-sep"></span>
    ${tb("dist-x", "ctx.distX", '<path d="M4 4v16M20 4v16M9 8h6v8H9z"/>')}
    ${tb("dist-y", "ctx.distY", '<path d="M4 4h16M4 20h16M8 9v6h8V9z"/>')}
    ${tb("group", "ctx.group", '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>')}
    ${tb("duplicate", "ctx.duplicate", '<path d="M9 9h10v10H9z"/><path d="M5 15V5h10"/>')}
    ${tb("delete", "ctx.delete", '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>')}`;
}

function stickySwatches() {
  return `<span class="ctx-swatches">${["pen", "accent", "shot", "titles", "thumb"]
    .map((c) => `<button class="swatch" data-sticky-fill="${c}" style="--swatch:var(--pen-${c === "pen" ? "default" : c})" aria-label="${c}"></button>`)
    .join("")}</span>`;
}

async function onContextClick(e) {
  const act = e.target.closest("[data-ctx]")?.dataset.ctx;
  const sticky = e.target.closest("[data-sticky-fill]")?.dataset.stickyFill;
  const strokeColor = e.target.closest("[data-stroke-color]")?.dataset.strokeColor;
  const strokeWidth = e.target.closest("[data-stroke-width]")?.dataset.strokeWidth;

  if (sticky) {
    for (const id of store.sel.cards) {
      const card = store.cardById(id);
      if (card?.type === "sticky") card.fill = sticky;
    }
    store.commit("sticky-fill");
    return;
  }
  if (strokeColor) {
    for (const id of store.sel.strokes) {
      const s = store.strokeById(id);
      if (s) s.color = strokeColor;
    }
    for (const id of store.sel.shapes) {
      const s = store.shapeById(id);
      if (s) s.color = strokeColor;
    }
    store.commit("stroke-color");
    return;
  }
  if (strokeWidth) {
    for (const id of store.sel.strokes) {
      const s = store.strokeById(id);
      if (s) s.width = Number(strokeWidth);
    }
    for (const id of store.sel.shapes) {
      const s = store.shapeById(id);
      if (s) s.width = Number(strokeWidth);
    }
    store.commit("stroke-width");
    return;
  }
  if (!act) return;

  if (act === "delete") {
    removeSelectionWithUndo();
    return;
  }
  if (act === "duplicate") {
    engine.duplicateSelection();
    updateContextBar();
    return;
  }
  if (act === "connect") {
    const ids = [...store.sel.cards];
    if (ids.length === 1) {
      toast({ text: t("toast.connectHint"), timeout: 3000 });
    } else {
      engine.addVineFromSelection();
    }
    return;
  }
  if (act.startsWith("align-")) {
    engine.align(act.slice(6));
    updateContextBar();
    return;
  }
  if (act === "dist-x") return engine.distribute("x");
  if (act === "dist-y") return engine.distribute("y");
  if (act === "group") return engine.groupIntoFrame();
  if (act === "vine-kind") {
    engine.toggleVineKind([...store.sel.vines][0]);
    return updateContextBar();
  }
  if (act === "vine-label" || act === "frame-label") {
    toast({ text: t("toast.labelHint"), timeout: 3000 });
    return;
  }
  if (act === "set-image") {
    const card = store.cardById([...store.sel.cards][0]);
    const blob = await pickBlob();
    if (card && blob) await setCardImage(card, blob);
    return;
  }
}

async function pickBlob() {
  if (!window.__TAURI__) return null;
  try {
    const picked = await window.__TAURI__.core.invoke("plugin:dialog|open", {
      options: { multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }] },
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return null;
    const res = await fetch(window.__TAURI__.core.convertFileSrc(path));
    return await res.blob();
  } catch (err) {
    errorToast(String(err.message || err));
    return null;
  }
}

function removeSelectionWithUndo() {
  const removed = engine.deleteSelection();
  if (!removed) return;
  const count = removed.cards.length + removed.vines.length + removed.frames.length + removed.strokes.length + removed.shapes.length;
  if (!count) return;
  toast({
    text: count === 1 ? t("toast.deleted", { n: count }) : t("toast.deletedPlural", { n: count }),
    actionLabel: t("common.undo"),
    onAction: () => store.undo(),
  });
  updateContextBar();
}

/* ───────────────────────── menus ───────────────────────── */

function openMoreMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const flip = document.documentElement.dir === "rtl";
  menu((flip ? rect.right + 180 : rect.left - 180) - (flip ? 180 : 0), rect.bottom + 8, [
    { label: t("menu.projects"), hint: "Esc", run: () => goto("start") },
    { label: t("menu.history"), hint: "Ctrl+H", run: () => toggleHistory(true) },
    { label: t("menu.ask"), hint: "Ctrl+J", run: () => toggleAi(true) },
    { separator: true },
    { label: t("menu.import"), run: () => document.getElementById("import-bloom").click() },
    { label: t("menu.export"), run: () => exportCurrentBloom() },
    { label: t("menu.exportScript"), hint: "Ctrl+E", run: () => exportScript("md") },
    { separator: true },
    { label: t("menu.settings"), hint: "Ctrl+,", run: () => openSettings() },
    { label: t("menu.shortcuts"), hint: "?", run: () => cheatSheet() },
    { label: t("menu.language"), run: () => switchLocale() },
    { label: t("menu.about"), run: () => about() },
  ]);
}

async function exportCurrentBloom() {
  try {
    const projects = await store.listProjects(true);
    const project = projects.find((p) => p.id === store.state.projectId);
    const picked = await store.invoke("plugin:dialog|save", {
      options: { defaultPath: `${(project?.name || "board").replace(/[^\w\- ]+/g, "").trim()}.bloom`, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
    });
    if (!picked) return;
    await store.invoke("export_bloom", { projectId: store.state.projectId, path: picked });
    toast({ text: t("toast.exported", { name: (project?.name || "board") + ".bloom" }) });
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

function about() {
  const body = document.createElement("div");
  body.className = "about";
  body.innerHTML = `<p class="about-name">Bloom</p>
    <p class="about-line">${t("about.tagline")}</p>
    <p class="about-line">${t("about.version", { version: num(info?.version || "0.1.0"), schema: num(info?.schemaVersion ?? "?") })}</p>
    <p class="about-line about-path">${escapeHtml(info?.dbPath || "")}</p>
    <div class="about-actions">
      <button class="btn btn-small" id="copy-diag">${t("about.diagnostics")}</button>
      <button class="btn btn-small" id="open-data">${t("about.data")}</button>
      <button class="btn btn-small" id="open-logs">${t("about.logs")}</button>
    </div>`;
  const modal = openModal({ title: t("about.title"), body });
  body.querySelector("#copy-diag").addEventListener("click", async () => {
    const text = [
      `Bloom ${info?.version}`,
      `schema ${info?.schemaVersion}`,
      `db ${info?.dbPath}`,
      `cards ${store.state.cards.length} vines ${store.state.vines.length} frames ${store.state.frames.length}`,
      `zoom ${store.state.viewport.zoom.toFixed(2)}`,
      `history ${JSON.stringify(store.historyDepth())}`,
      `ua ${navigator.userAgent}`,
      "--- log tail ---",
      (await store.invoke?.("tail_log", { lines: 60 }).catch(() => "")) || "(no log)",
    ].join("\n");
    await navigator.clipboard?.writeText(text);
    toast({ text: t("toast.diagnostics") });
    modal.close();
  });
  body.querySelector("#open-logs").addEventListener("click", async () => {
    const dir = await store.invoke?.("logs_dir").catch(() => null);
    if (dir) store.invoke("open_folder", { path: dir }).catch((e) => errorToast(String(e)));
  });
  body.querySelector("#open-data").addEventListener("click", () => {
    store.invoke("open_folder", { path: String(info?.dataDir || "") }).catch((e) => errorToast(String(e)));
  });
}

/* ───────────────────────── hotkeys ───────────────────────── */

function isTyping(e) {
  const t = e.target;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function wireKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (modalOpen()) return closeModal();
      if (menuOpen()) return closeMenu();
      if (paletteOpen()) return closePalette();
      if (engine.selectionCount()) {
        store.clearSelection();
        engine.redraw();
        return updateContextBar();
      }
      return setTool("select");
    }
    if (paletteOpen()) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        movePaletteActive(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        runPaletteActive();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const typing = isTyping(e);
    const globalMods = ["k", "h", "j", "e", "s", "]", "["];
    if (typing && !(mod && (globalMods.includes(e.key.toLowerCase()) || e.key === "," || e.key === "Enter"))) {
      if (e.key === "Escape") e.target.blur();
      return;
    }

    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      return openSearch();
    }
    if (mod && e.key.toLowerCase() === "h") {
      e.preventDefault();
      return toggleHistory();
    }
    if (mod && e.key.toLowerCase() === "j") {
      e.preventDefault();
      return toggleAi();
    }
    if (mod && e.key === ",") {
      e.preventDefault();
      return openSettings();
    }
    if (mod && e.key.toLowerCase() === "e") {
      e.preventDefault();
      return exportScript("md");
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      awaitSnapshot();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const label = e.shiftKey ? store.redo() : store.undo();
      if (label) toast({ text: t(e.shiftKey ? "toast.redid" : "toast.undid", { label }), timeout: 2200 });
      updateContextBar();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      engine.duplicateSelection();
      return updateContextBar();
    }
    if (mod && e.key.toLowerCase() === "c") {
      engine.copySelection();
      engine.copyToSystem();
      return;
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteIntoCanvas();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      engine.selectAll();
      return updateContextBar();
    }
    if (mod && e.key === "Enter") {
      e.preventDefault();
      return goto(screen === "script" ? "canvas" : "script");
    }
    if (mod && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      engine.zOrder(e.key === "]" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward");
      return;
    }
    if (e.key === "F11") {
      e.preventDefault();
      window.__TAURI__?.window?.getCurrentWindow?.().isFullscreen().then((full) =>
        window.__TAURI__.window.getCurrentWindow().setFullscreen(!full),
      );
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      return openAdd();
    }
    if (e.key === "?") {
      e.preventDefault();
      return cheatSheet();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return removeSelectionWithUndo();
    }
    if (e.key.startsWith("Arrow")) {
      const step = e.shiftKey ? 8 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      if (engine.nudge(dx, dy)) {
        e.preventDefault();
        updateContextBar();
      }
      return;
    }
    if (e.key.toLowerCase() === "g") {
      toggleSnap();
      return;
    }
    const tools = { v: "select", h: "pan", n: "add", f: "frame", c: "vine", p: "pen", e: "eraser", r: "rect", o: "ellipse", l: "arrow", i: "image" };
    const tool = tools[e.key.toLowerCase()];
    if (tool && !mod) {
      if (tool === "add") return openAdd();
      if (tool === "image") return pickImage(engine.pointerWorld());
      if (tool === "frame") {
        engine.insertFrame();
        return updateContextBar();
      }
      if (tool === "vine") {
        return toast({ text: t("toast.connectHint"), timeout: 3000 });
      }
      setTool(tool);
    }
  });
}

async function awaitSnapshot() {
  try {
    await store.snapshot("manual");
    toast({ text: t("toast.snapshot") });
    if (historyOpen()) renderHistory();
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

function toggleSnap() {
  store.state.snap = !store.state.snap;
  paintChrome();
}

/* ───────────────────────── paste + drop ───────────────────────── */

async function pasteIntoCanvas(world = engine.pointerWorld()) {
  const payload = engine.clipboardPayload();
  const text = await navigator.clipboard?.readText().catch(() => "");
  const fromSystem = text ? tryParse(text) : null;
  if (fromSystem?.cards?.length) {
    engine.clipboard = fromSystem;
  } else if (!payload && text.trim()) {
    if (/^https?:\/\/\S+$/i.test(text.trim())) {
      createSourceFromUrl(text.trim(), world);
      return;
    }
    engine.insertCard("sticky", world);
    const card = store.state.cards[store.state.cards.length - 1];
    card.text = text.trim();
    store.commit("paste");
    return;
  }
  engine.pasteInternal(world);
  updateContextBar();
}

function tryParse(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.bloom === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function createSourceFromUrl(url, world) {
  const card = store.makeCard("source", world.x, world.y, { url, title: "", z: store.nextZ() });
  store.state.cards.push(card);
  store.commit("source");
  store.invoke?.("fetch_page_title", { url })
    .then((res) => {
      if (res?.title) {
        card.title = res.title;
        store.commit("source-title");
      } else if (!card.title) {
        try {
          card.title = new URL(url).hostname;
        } catch {
          card.title = url;
        }
        store.commit("source-title");
      }
    })
    .catch(() => {
      card.title = card.title || url;
      store.commit("source-title");
    });
}

function wirePasteAndDrop() {
  document.addEventListener("paste", (e) => {
    if (isTyping(e)) return;
    const image = blobFromClipboard(e);
    if (image) {
      e.preventDefault();
      ingestFiles([image], engine.pointerWorld());
      return;
    }
    if (engine.selectionCount()) return;
    e.preventDefault();
    pasteIntoCanvas();
  });

  const screenEl = $("#screen-canvas");
  screenEl.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) {
      e.preventDefault();
      screenEl.classList.add("is-dropping");
    }
  });
  screenEl.addEventListener("dragleave", () => screenEl.classList.remove("is-dropping"));
  screenEl.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    e.preventDefault();
    screenEl.classList.remove("is-dropping");
    ingestFiles(files, engine.toWorld(e.clientX, e.clientY));
  });
}

/* ───────────────────────── wiring ───────────────────────── */

function wireChrome() {
  $$(".seg").forEach((b) => b.addEventListener("click", () => goto(b.dataset.view)));
  $$(".tool").forEach((b) =>
    b.addEventListener("click", () => {
      const name = b.dataset.tool;
      if (name === "card") return openAdd();
      if (name === "frame") {
        engine.insertFrame();
        return updateContextBar();
      }
      if (name === "image") return pickImage(engine.pointerWorld());
      if (name === "vine") return toast({ text: t("toast.connectHint"), timeout: 3000 });
      setTool(name);
    }),
  );
  $("#zoom-btn").addEventListener("click", () => engine.fitAll());
  $("#search-btn").addEventListener("click", () => openAdd());
  $("#home-btn").addEventListener("click", () => goto("start"));
  $("#home-btn-start").addEventListener("click", () => goto("canvas"));
  $("#status-pill").addEventListener("click", () => {
    const i = store.STATUSES.indexOf(store.state.status);
    store.setStatus(store.STATUSES[(i + 1) % store.STATUSES.length]);
    paintChrome();
  });
  $("#project-name").addEventListener("input", (e) => {
    store.renameProject(e.target.textContent.trim() || t("app.untitled"));
  });
  $("#save-state").addEventListener("click", () => {
    if ($("#save-state").dataset.state === "error") store.saveNow();
  });
  $("#more-btn").addEventListener("click", (e) => openMoreMenu(e.currentTarget));
  $("#lang-btn").addEventListener("click", () => switchLocale());
  $("#ai-btn").hidden = isPhone();
  wasPhone = isPhone();
  addEventListener("resize", () => {
    const now = isPhone();
    if (now === wasPhone) return;
    wasPhone = now;
    $("#ai-btn").hidden = now;
    renderProjects();
    if (now && screen === "canvas") engine.fitAll();
  });
  $("#ai-btn").addEventListener("click", () => toggleAi());
  $("#snap-indicator").addEventListener("click", () => {
    store.state.snap = false;
    paintChrome();
  });

  $("#screen-canvas").addEventListener("contextmenu", (e) => {
    const vine = e.target.closest("[data-vine]");
    const cardEl = e.target.closest("[data-card]");
    if (vine) {
      e.preventDefault();
      const id = vine.dataset.vine;
      const v = store.vineById(id);
      menu(e.clientX, e.clientY, [
        { label: t(v?.kind === "script" ? "ctx.removeScript" : "ctx.makeScript"), run: () => engine.toggleVineKind(id) },
        { label: t("ctx.editLabel"), run: () => toast({ text: t("toast.labelHint"), timeout: 2500 }) },
        { label: t("menu.deleteVine"), run: () => { store.selectOnly(id, "vines"); removeSelectionWithUndo(); } },
      ]);
      return;
    }
    if (cardEl) return;
    e.preventDefault();
    const world = engine.toWorld(e.clientX, e.clientY);
    menu(e.clientX, e.clientY, [
      { label: t("menu.add"), run: () => openAdd() },
      { label: t("menu.paste"), run: () => pasteIntoCanvas(world) },
      { label: t(store.state.snap ? "menu.snapOn" : "menu.snapOff"), run: toggleSnap },
      { label: t("menu.fit"), run: () => engine.fitAll() },
      { label: t("menu.shortcuts"), run: () => cheatSheet() },
    ]);
  });

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#menu")) closeMenu();
  });

  $("#export-script").addEventListener("click", (e) => {
    menu(e.clientX, e.clientY, [
      { label: t("script.exportMd"), hint: "Ctrl+E", run: () => exportScript("md") },
      { label: t("script.exportTxt"), run: () => exportScript("txt") },
      { label: t("script.copy"), run: () => exportScript("copy") },
    ]);
  });
  $("#teleprompter").addEventListener("click", () => openTeleprompter());
  $("#import-bloom").addEventListener("click", () => importBloomFlow());
  $("#export-bloom").addEventListener("click", () => exportCurrentBloom());
  $("#open-history-btn").addEventListener("click", () => toggleHistory(true));
}

async function importBloomFlow(explicitPath = null) {
  try {
    let path = explicitPath;
    if (!path) {
      const picked = await store.invoke("plugin:dialog|open", {
        options: { multiple: false, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
      });
      path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
    }
    const created = await store.invoke("import_bloom", { path });
    toast({ text: t("toast.imported", { name: created.name }) });
    document.dispatchEvent(new CustomEvent("bloom:projects-changed"));
    await openProject(created.id, onBoardLoaded);
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

async function onBoardLoaded(board) {
  await store.saveNow();
  await store.applyBoard(board);
  engine.renderAll();
  paintChrome();
  goto("canvas");
  // a phone cannot inherit a desktop viewport: show the whole board instead
  if (isPhone()) engine.fitAll();
  initScript();
  renderScript();
}

/* ───────────────────────── boot ───────────────────────── */

const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
let wasPhone = null;

function switchLocale() {
  const next = getLocale() === "fa" ? "en" : "fa";
  setLocale(next);
  store.saveSettings({ locale: next });
  refreshLocale();
}

function refreshLocale() {
  paintChrome();
  engine.invalidateAll();
  if (screen === "canvas") engine.renderAll();
  engine.redraw();
  refreshHints();
  updateContextBar();
  if (screen === "script") {
    markScriptDirty();
    renderScript();
  }
  if (screen === "start") renderProjects();
  if (historyOpen()) renderHistory();
}

async function boot() {
  await store.boot();
  setLocale(store.settings.locale || localeFromStorage(), { persist: false, silent: true });
  onLocaleChange(() => refreshLocale());
  info = await store.invoke?.("app_info").catch(() => null);
  engine.setMediaBase(info?.dataDir || "");
  engine.init({
    onChange: (kind) => {
      paintChrome();
      if (kind === "board" || kind === "selection") updateContextBar();
      if (screen === "script" && !$("#script-rows").contains(document.activeElement)) {
        markScriptDirty();
        renderScript();
      }
    },
    onPinDrop: (world, connection) => openAdd("", connection),
    onEmptyDblClick: () => openAdd(),
  });
  initPalette();
  initScript();
  initProjects({
    onOpen: (board) => onBoardLoaded(board),
    onNew: async (templateId) => {
      const created = await newBoard(templateId, onBoardLoaded);
      renderProjects();
      return created;
    },
  });
  initHistory({ onRestore: (board) => onBoardLoaded(board) });
  initAi();
  wireChrome();
  wireKeys();
  wirePasteAndDrop();

  engine.renderAll();
  paintChrome();
  goto("canvas");
  updateContextBar();

  document.documentElement.classList.toggle("reduce-motion", store.settings.reduceMotion);
  if (!store.settings.hintsSeen) {
    showHints({
      onDone: () => store.saveSettings({ hintsSeen: true }),
    });
  }

  store.on((kind) => {
    if (kind === "reload") {
      engine.renderAll();
      paintChrome();
      updateContextBar();
      if (screen === "script") {
        markScriptDirty();
        renderScript();
      }
    }
    if (kind === "meta") paintChrome();
  });

  // a .bloom opened from Explorer
  store.invoke?.("take_launch_file").then((path) => {
    if (path) importBloomFlow(path);
  }).catch(() => {});

  setInterval(updateContextBar, 400);
  window.addEventListener("beforeunload", () => store.saveNow());
}

window.__bloom = {
  store,
  engine,
  goto,
  openAdd,
  openSearch,
  openSettings,
  updateContextBar,
  counts: () => ({
    cards: document.querySelectorAll("[data-card]").length,
    vines: document.querySelectorAll("path.vine").length,
    strokes: document.querySelectorAll("path.stroke").length,
    selected: engine.selectionCount(),
    ctxbar: !$("#ctxbar").hidden,
  }),
  history: store.historyDepth,
  saveNow: store.saveNow,
  info: () => info,
};

window.addEventListener("error", (event) => {
  const message = event.error?.stack || event.message || "unknown error";
  console.error("uncaught", message);
  store.invoke?.("log_client", { level: "error", message: String(message) }).catch(() => {});
  toast({ text: t("toast.error"), tone: "error" });
});
window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.stack || String(event.reason || "unhandled rejection");
  console.error("unhandled", message);
  store.invoke?.("log_client", { level: "error", message: String(message) }).catch(() => {});
});

boot().catch((err) => {
  console.error("boot failed", err);
  const host = document.createElement("pre");
  host.className = "boot-error";
  host.textContent = `${t("error.boot")}: ${err?.stack || err}`;
  document.body.appendChild(host);
});
