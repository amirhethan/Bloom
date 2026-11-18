// Bloom — unified command bar: add items + board search.

import { state, primaryText, TINTS, words } from "./store.js";
import { t } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

export const ADD_ITEMS = [
  { type: "idea", key: "idea", tint: "accent" },
  { type: "hook", key: "hook", tint: "hook" },
  { type: "script", key: "script", tint: "accent" },
  { type: "shot", key: "shot", tint: "shot" },
  { type: "source", key: "source", tint: "source" },
  { type: "sticky", key: "sticky", tint: "pen" },
  { type: "image", key: "image", tint: "text-2" },
  { type: "frame", key: "frame", tint: "text-muted" },
  { type: "draw", key: "draw", tint: "text-muted" },
];
const itemLabel = (item) => t(`palette.${item.key}`);
const itemDesc = (item) => t(`palette.${item.key}Desc`);

let opts = null;
let rows = [];
let active = 0;

export const paletteOpen = () => !$("#cmdbar").hidden;

export function openPalette(options = {}) {
  opts = { mode: "add", onAdd: () => {}, onFocus: () => {}, onDraw: () => {}, ...options };
  const bar = $("#cmdbar");
  bar.hidden = false;
  bar.classList.toggle("is-connect", Boolean(opts.connect));
  const input = $("#cmd-input");
  input.value = options.seed || "";
  input.placeholder = opts.connect ? t("palette.connect") : t("palette.add");
  active = 0;
  render();
  input.focus();
  input.select();
}

export function closePalette() {
  $("#cmdbar").hidden = true;
  opts = null;
  $("#cmd-input").blur();
}

export function movePaletteActive(delta) {
  if (!rows.length) return;
  // the "On this board" header is not selectable
  let next = active;
  for (let i = 0; i < rows.length; i++) {
    next = (next + delta + rows.length) % rows.length;
    if (rows[next].kind !== "group") break;
  }
  active = next;
  paintActive();
}

export function runPaletteActive() {
  const row = rows[active];
  if (!row || row.kind === "group" || !opts) return;
  // closePalette() nulls opts, so the callbacks have to be captured first
  const actions = opts;
  closePalette();
  if (row.kind === "add") {
    if (row.type === "draw") actions.onDraw();
    else actions.onAdd(row.type, actions.connect);
  } else {
    actions.onFocus(row.id);
  }
}

export function paletteContext() {
  return opts;
}

function searchCards(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return state.cards
      .slice()
      .sort((a, b) => b.z - a.z)
      .slice(0, 5)
      .map((c) => ({ kind: "card", id: c.id, card: c, snippet: snippetOf(c) }));
  }
  return state.cards
    .filter((c) => {
      const hay = [primaryText(c), c.title, c.body, c.text, c.section, c.url, c.quote, c.notes, c.overlay, c.caption]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 8)
    .map((c) => ({ kind: "card", id: c.id, card: c, snippet: snippetOf(c) }));
}

function snippetOf(card) {
  const text = primaryText(card) || "";
  return text.replace(/\s+/g, " ").slice(0, 90);
}

function render() {
  const query = $("#cmd-input").value;
  const addMatches = ADD_ITEMS.filter((i) => (opts.connect ? i.type !== "frame" : true)).filter((i) =>
    (itemLabel(i) + " " + itemDesc(i) + " " + i.key).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const cardMatches = opts.mode === "search" || query.trim() ? searchCards(query) : [];
  rows = [
    ...addMatches.map((i) => ({ ...i, kind: "add" })),
    ...(query.trim() && cardMatches.length ? [{ kind: "group", label: t("palette.onBoard") }] : []),
    ...cardMatches.map((c) => ({ ...c, label: primaryText(c.card) || t("app.untitled"), tint: TINTS[c.card.type] || "text-2" })),
  ];
  if (opts.mode === "connect") rows = rows.filter((r) => r.kind !== "group");
  active = Math.min(active, Math.max(0, rows.length - 1));
  // a search starts on the first real result, never on the group header
  if (rows[active]?.kind === "group") {
    const first = rows.findIndex((r) => r.kind !== "group");
    if (first >= 0) active = first;
  }

  $("#cmd-list").innerHTML = rows
    .map((row, i) => {
      if (row.kind === "group") return `<div class="cmd-group">${escapeHtml(row.label)}</div>`;
      const isCard = row.kind === "card";
      const dot = `<span class="dot" style="background:var(--tint-${row.tint})"></span>`;
      return `<button class="cmd-row${i === active ? " is-active" : ""}" data-row="${i}">
        ${dot}
        <span class="cmd-label">${escapeHtml(isCard ? row.card.type : itemLabel(row))}</span>
        <span class="desc">${escapeHtml(isCard ? row.snippet : itemDesc(row))}</span>
      </button>`;
    })
    .join("");
}

function paintActive() {
  [...document.querySelectorAll(".cmd-row")].forEach((el, i) => el.classList.toggle("is-active", i === active));
}

export function initPalette() {
  $("#cmd-input").addEventListener("input", () => {
    active = 0;
    render();
  });
  $("#cmd-list").addEventListener("mousemove", (e) => {
    const row = e.target.closest("[data-row]");
    if (!row) return;
    active = Number(row.dataset.row);
    paintActive();
  });
  $("#cmd-list").addEventListener("click", (e) => {
    const row = e.target.closest("[data-row]");
    if (!row) return;
    active = Number(row.dataset.row);
    runPaletteActive();
  });
}

export const addItemFor = (type) => ADD_ITEMS.find((i) => i.type === type);
export const snippetLength = (card) => words(primaryText(card));
