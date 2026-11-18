// Bloom — overlays: toasts, modal, menus, cheat sheet, first-run hints.

import { t } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

const HOTKEYS = [
  ["cheat.tools", ""],
  ["V", "tool.select"],
  ["H", "tool.pan"],
  ["N", "tool.card"],
  ["F", "tool.frame"],
  ["P", "tool.pen"],
  ["E", "pen.eraser"],
  ["R", "pen.rect"],
  ["O", "pen.ellipse"],
  ["L", "pen.arrow"],
  ["/", "cheat.commandBar"],
  ["Ctrl+K", "cheat.searchBoard"],
  ["cheat.board", ""],
  ["Space + drag", "tool.pan"],
  ["Wheel", "cheat.wheel"],
  ["Ctrl+wheel", "cheat.alwaysZoom"],
  ["Ctrl+A", "cheat.selectAll"],
  ["Shift/⌘ click", "cheat.addSelection"],
  ["Arrows", "cheat.nudge1"],
  ["Shift+Arrows", "cheat.nudge8"],
  ["Ctrl+] / [", "cheat.zOrder"],
  ["Ctrl+Shift+] / [", "cheat.zFront"],
  ["Ctrl+D", "ctx.duplicate"],
  ["Ctrl+C / V", "cheat.copyPaste"],
  ["Del", "ctx.delete"],
  ["Ctrl+Z / Shift+Z", "cheat.undoRedo"],
  ["G", "cheat.snap"],
  ["cheat.views", ""],
  ["Ctrl+Enter", "cheat.toggleView"],
  ["Ctrl+H", "menu.history"],
  ["Ctrl+J", "menu.ask"],
  ["Ctrl+,", "menu.settings"],
  ["Ctrl+S", "cheat.snapshot"],
  ["Ctrl+E", "menu.exportScript"],
  ["?", "menu.shortcuts"],
  ["F11", "cheat.fullscreen"],
];

/* ───────────── toasts ───────────── */

const MAX_TOASTS = 3;
const toastTimers = new Map();

export function toast({ text, actionLabel, onAction, tone = "default", timeout = 5000, icon }) {
  const host = $("#toasts");
  if (!host) return null;
  const el = document.createElement("div");
  el.className = `toast${tone === "error" ? " is-error" : ""}`;
  el.setAttribute("role", "status");
  el.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ""}<span class="toast-text">${escapeHtml(text)}</span>${
    actionLabel ? `<button class="toast-action">${escapeHtml(actionLabel)}</button>` : ""
  }`;
  host.appendChild(el);
  while (host.children.length > MAX_TOASTS) {
    const first = host.firstElementChild;
    clearTimeout(toastTimers.get(first));
    toastTimers.delete(first);
    first.remove();
  }
  const dismiss = () => {
    clearTimeout(toastTimers.get(el));
    toastTimers.delete(el);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 140);
  };
  const arm = () => {
    if (!timeout) return;
    clearTimeout(toastTimers.get(el));
    toastTimers.set(el, setTimeout(dismiss, timeout));
  };
  arm();
  el.addEventListener("mouseenter", () => clearTimeout(toastTimers.get(el)));
  el.addEventListener("mouseleave", arm);
  const action = el.querySelector(".toast-action");
  if (action) {
    action.addEventListener("click", () => {
      onAction?.();
      dismiss();
    });
  }
  return { dismiss };
}

export const errorToast = (text, onAction) =>
  toast({ text, tone: "error", actionLabel: onAction ? t("common.retry") : null, onAction, timeout: 8000 });

/* ───────────── modal ───────────── */

let lastFocus = null;

export function openModal({ title, body, wide = false, footer = "", onClose }) {
  const root = $("#modal-root");
  lastFocus = document.activeElement;
  root.innerHTML = `<div class="modal-scrim"></div>
    <div class="modal-card${wide ? " is-wide" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-head"><h2>${escapeHtml(title)}</h2><button class="icon-btn modal-close" aria-label="${t("common.close")}"><svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
      <div class="modal-body"></div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}
    </div>`;
  const bodyEl = root.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);
  root.hidden = false;
  const close = () => {
    root.hidden = true;
    root.innerHTML = "";
    onClose?.();
    lastFocus?.focus?.();
  };
  root.querySelector(".modal-close").addEventListener("click", close);
  root.querySelector(".modal-scrim").addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  root.querySelector(".modal-card").tabIndex = -1;
  root.querySelector(".modal-card").focus();
  return { close, body: bodyEl };
}

export function closeModal() {
  const root = $("#modal-root");
  if (!root.hidden) {
    root.hidden = true;
    root.innerHTML = "";
  }
}

export const modalOpen = () => !$("#modal-root").hidden;

/* ───────────── menus ───────────── */

export function menu(x, y, items, { align = "left" } = {}) {
  const el = $("#menu");
  el.innerHTML = items
    .map((it, i) =>
      it.separator
        ? `<span class="menu-sep"></span>`
        : `<button class="menu-row" data-menu="${i}"${it.disabled ? " disabled" : ""}>
            <span>${escapeHtml(it.label)}</span>${it.hint ? `<kbd>${escapeHtml(it.hint)}</kbd>` : ""}
          </button>`,
    )
    .join("");
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.hidden = false;
  const rect = el.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) el.style.left = `${Math.max(8, x - rect.width)}px`;
  if (rect.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, y - rect.height)}px`;
  el.onclick = (e) => {
    const row = e.target.closest("[data-menu]");
    if (!row) return;
    el.hidden = true;
    const item = items[Number(row.dataset.menu)];
    if (item && !item.disabled) item.run();
  };
  return el;
}

export function closeMenu() {
  $("#menu").hidden = true;
}

export const menuOpen = () => !$("#menu").hidden;

/* ───────────── cheat sheet ───────────── */

export function cheatSheet() {
  const items = HOTKEYS.map(([key, label]) =>
    label
      ? `<div class="cheat-row"><span class="cheat-key">${key.split(" / ").map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join("")}</span><span>${escapeHtml(t(label))}</span></div>`
      : `<div class="cheat-group">${escapeHtml(t(key))}</div>`,
  ).join("");
  const wrap = document.createElement("div");
  wrap.className = "cheat";
  wrap.innerHTML = items;
  openModal({ title: t("cheat.title"), body: wrap, wide: true });
}

/* ───────────── first-run hints ───────────── */

const HINTS = [
  { title: "hints.1.title", text: "hints.1.text", at: "center" },
  { title: "hints.2.title", text: "hints.2.text", at: "left" },
  { title: "hints.3.title", text: "hints.3.text", at: "right" },
];

let hintState = { index: 0, onDone: () => {}, paint: null };

export function refreshHints() {
  if ($("#hints")?.hidden) return;
  hintState.paint?.();
}

export function showHints({ onDone = () => {}, startAt = 0 } = {}) {
  let index = startAt;
  const host = $("#hints");
  const paint = () => {
    if (index >= HINTS.length) {
      host.hidden = true;
      host.innerHTML = "";
      onDone();
      return;
    }
    const hint = HINTS[index];
    host.hidden = false;
    const title = t(hint.title);
    host.innerHTML = `<div class="hint-card hint-${hint.at}" role="dialog" aria-label="${escapeHtml(title)}">
      <div class="hint-step">${t("hints.step", { n: index + 1, total: HINTS.length })}</div>
      <div class="hint-title">${escapeHtml(title)}</div>
      <p class="hint-text">${escapeHtml(t(hint.text))}</p>
      <div class="hint-actions">
        <button class="hint-skip">${t("common.skipAll")}</button>
        <button class="btn btn-accent hint-next">${t(index === HINTS.length - 1 ? "common.done" : "common.next")}</button>
      </div>
    </div>`;
    host.querySelector(".hint-skip").addEventListener("click", () => {
      index = HINTS.length;
      paint();
    });
    host.querySelector(".hint-next").addEventListener("click", () => {
      index++;
      paint();
    });
  };
  hintState = { get index() { return index; }, onDone, paint };
  paint();
  return { stop: () => { index = HINTS.length; paint(); } };
}
