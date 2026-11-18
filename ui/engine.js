// Bloom — canvas engine: rendering, selection, drag, resize, vines, frames,
// pen, shapes, guides, pins, z-order and clipboard.

import {
  state, sel, commit, clearSelection, isEmptySelection, makeCard, makeShape, nextZ, uid,
  cardById, frameById, vineById, strokeById, shapeById, words, secondsFor, SNAP_GRID,
  HOOK_STYLES, CARD_TYPES, TINTS, primaryText, convertCardType, scheduleSave, markViewportDirty, on,
  settings, PEN_COLORS, PEN_WIDTHS,
} from "./store.js";
import { t, num } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snapValue = (v) => (state.snap ? Math.round(v / SNAP_GRID) * SNAP_GRID : Math.round(v));
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

const typeLabel = (type) => t(`type.${type}`);
const HOOK_STYLE_KEY = {
  "question": "hookStyle.question",
  "bold claim": "hookStyle.boldClaim",
  "story": "hookStyle.story",
  "pattern interrupt": "hookStyle.patternInterrupt",
};
const hookStyleLabel = (style) => t(HOOK_STYLE_KEY[style] || "hookStyle.boldClaim");
const PIN_NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const STAR_PATH = "M8 1.4l2.05 4.15 4.58.67-3.31 3.23.78 4.56L8 11.86l-4.1 2.15.78-4.56L1.37 6.22l4.58-.67z";

let dom = {};
const cardEls = new Map();
const frameEls = new Map();
let shapeEls = new Map();
let tool = "select";
let pen = { kind: "pen", color: "pen", width: 1.6 };
let drag = null;
let spaceDown = false;
let clipboard = [];
let lastWorld = { x: 140, y: 160 };
let mediaBase = "";
let hooks = { onChange: () => {}, onPinDrop: () => {}, onLabelEdit: null };
let guides = [];

const star = (filled) =>
  `<svg class="star" viewBox="0 0 16 16" aria-hidden="true"><path d="${STAR_PATH}" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const setMediaBase = (base) => { mediaBase = base || ""; };

function assetUrl(src) {
  if (!src) return "";
  if (mediaBase && window.__TAURI__?.core?.convertFileSrc) {
    const path = `${mediaBase.replace(/\\/g, "/")}/${src}`;
    return window.__TAURI__.core.convertFileSrc(path);
  }
  return src;
}

/* ───────────────────────── card markup ───────────────────────── */

function cardMarkup(c) {
  const head = (aside = "") =>
    `<div class="card-head"><span class="dot"></span><span class="card-label">${typeLabel(c.type)}</span>${aside}</div>`;

  switch (c.type) {
    case "sticky":
      return `<div class="sticky-body" contenteditable="true" dir="auto" data-field="text" spellcheck="false">${escapeHtml(c.text)}</div>`;
    case "idea":
      return `${head()}
        <div class="title" contenteditable="true" dir="auto" data-field="title" spellcheck="false">${escapeHtml(c.title)}</div>
        <div class="body" contenteditable="true" dir="auto" data-field="body" spellcheck="false">${escapeHtml(c.body)}</div>`;
    case "hook":
      return `${head(`<button class="card-aside" data-act="style" title="${t("card.changeStyle")}">${escapeHtml(hookStyleLabel(c.style))}</button>`)}
        <div class="hook-text" contenteditable="true" dir="auto" data-field="text" spellcheck="false">${escapeHtml(c.text)}</div>`;
    case "script":
      return `${head(`<span class="card-aside" contenteditable="true" dir="auto" data-field="section" spellcheck="false">${escapeHtml(c.section)}</span>`)}
        <div class="body" contenteditable="true" dir="auto" data-field="text" spellcheck="false">${escapeHtml(c.text)}</div>
        <div class="foot">${t("script.words", { n: words(c.text), s: secondsFor(words(c.text)) })}</div>`;
    case "shot":
      return `${head()}
        <div class="shot-text" contenteditable="true" dir="auto" data-field="text" spellcheck="false">${escapeHtml(c.text)}</div>
        <div class="shot-meta">
          <button class="pill status${c.status === "needed" ? "" : " is-have"}" data-act="status">${escapeHtml(t("shot." + c.status))}</button>
          <span class="tag" contenteditable="true" dir="auto" data-field="tag" spellcheck="false">${escapeHtml(c.tag)}</span>
        </div>`;
    case "titles":
      return `${head()}
        <div class="list">${(c.items || [])
          .map(
            (it) => `<div class="title-row${it.id === c.chosen ? " is-chosen" : ""}" data-title="${it.id}">
                <button class="star-btn" data-act="choose" data-title="${it.id}" aria-label="${t("card.chooseTitle")}">${star(it.id === c.chosen)}</button>
                <span contenteditable="true" dir="auto" data-item="${it.id}" spellcheck="false">${escapeHtml(it.text)}</span>
              </div>`,
          )
          .join("")}
        </div>`;
    case "thumbnail":
      return `${head()}
        <div class="concept">${c.image ? `<img class="concept-img" src="${assetUrl(c.image.src)}" alt="" />` : ""}
          <span contenteditable="true" dir="auto" data-field="overlay" spellcheck="false">${escapeHtml(c.overlay)}</span>
        </div>`;
    case "image":
      return `<div class="image-body">${
        c.image
          ? `<img src="${assetUrl(c.image.src)}" alt="${escapeHtml(c.caption || t("card.image"))}" draggable="false" />`
          : `<div class="image-empty">${t("card.dropImage")}</div>`
      }</div>
      <div class="image-caption" contenteditable="true" dir="auto" data-field="caption" spellcheck="false">${escapeHtml(c.caption || "")}</div>`;
    case "source":
      return `${head()}
        <div class="source-title" contenteditable="true" dir="auto" data-field="title" spellcheck="false">${escapeHtml(c.title || "")}</div>
        <div class="source-url" contenteditable="true" dir="ltr" data-field="url" spellcheck="false">${escapeHtml(c.url || "")}</div>
        <div class="source-quote" contenteditable="true" dir="auto" data-field="quote" spellcheck="false">${escapeHtml(c.quote || "")}</div>
        <div class="source-notes" contenteditable="true" dir="auto" data-field="notes" spellcheck="false">${escapeHtml(c.notes || "")}</div>`;
    default:
      return `${head()}<div class="body">${escapeHtml(c.text || "")}</div>`;
  }
}

const sigOf = (c) => `${c.type}|${JSON.stringify({ ...c, x: 0, y: 0, z: 0 })}`;

function pinsMarkup() {
  return `<span class="pin" data-pin="top"></span><span class="pin" data-pin="right"></span>
    <span class="pin" data-pin="bottom"></span><span class="pin" data-pin="left"></span>`;
}

function ariaFor(c) {
  const text = primaryText(c).replace(/\s+/g, " ").slice(0, 80);
  return `${typeLabel(c.type)}${text ? ": " + text : ""}`;
}

function createCardEl(c) {
  const el = document.createElement("div");
  el.className = c.type === "sticky" ? "sticky" : `card card-${c.type}`;
  el.dataset.card = c.id;
  el.dataset.type = c.type;
  el.setAttribute("role", "group");
  el.tabIndex = 0;
  el.innerHTML = `${cardMarkup(c)}${c.type === "sticky" ? "" : pinsMarkup()}`;
  if (c.type === "image" && c.image) el.dataset.ratio = String(c.image.width / c.image.height || 1);
  if (c.rotation) el.style.transform = `rotate(${c.rotation}deg)`;
  return el;
}

function updateCardEl(el, c) {
  el.style.left = `${c.x}px`;
  el.style.top = `${c.y}px`;
  el.style.width = `${c.w}px`;
  if (c.h) el.style.minHeight = `${c.h}px`;
  el.style.zIndex = String(c.z || 1);
  const label = ariaFor(c);
  if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
  const sig = sigOf(c);
  if (el.dataset.sig !== sig && !el.contains(document.activeElement)) {
    el.innerHTML = `${cardMarkup(c)}${c.type === "sticky" ? "" : pinsMarkup()}`;
    el.dataset.sig = sig;
  }
  el.classList.toggle("is-selected", sel.cards.has(c.id));
}

/* ───────────────────────── render ───────────────────────── */

export function syncCards() {
  const seen = new Set();
  const order = [...state.cards].sort((a, b) => a.y - b.y || a.x - b.x);
  order.forEach((c, i) => {
    seen.add(c.id);
    let el = cardEls.get(c.id);
    if (!el) {
      el = createCardEl(c);
      el.dataset.sig = sigOf(c);
      dom.cards.appendChild(el);
      cardEls.set(c.id, el);
    }
    updateCardEl(el, c);
    if (el.style.tabIndex !== String(i + 1)) el.tabIndex = i + 1;
  });
  for (const [id, el] of cardEls) {
    if (!seen.has(id)) {
      el.remove();
      cardEls.delete(id);
    }
  }
}

export function syncFrames() {
  const seen = new Set();
  for (const f of state.frames) {
    seen.add(f.id);
    let el = frameEls.get(f.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "frame";
      el.dataset.frame = f.id;
      el.innerHTML = `<span class="frame-label" data-frame-field="label"></span>`;
      dom.world.appendChild(el);
      frameEls.set(f.id, el);
    }
    el.style.left = `${f.x}px`;
    el.style.top = `${f.y}px`;
    el.style.width = `${f.w}px`;
    el.style.height = `${f.h}px`;
    el.classList.toggle("is-selected", sel.frames.has(f.id));
    const label = el.querySelector(".frame-label");
    if (label && label.textContent !== f.label && !label.contains(document.activeElement)) label.textContent = f.label;
  }
  for (const [id, el] of frameEls) {
    if (!seen.has(id)) {
      el.remove();
      frameEls.delete(id);
    }
  }
}

const rectOf = (id) => {
  const el = cardEls.get(id);
  return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
};

export const cardRect = (id) => rectOf(id);

function pinPoint(rect, side) {
  switch (side) {
    case "top": return [rect.x + rect.w / 2, rect.y];
    case "right": return [rect.x + rect.w, rect.y + rect.h / 2];
    case "bottom": return [rect.x + rect.w / 2, rect.y + rect.h];
    default: return [rect.x, rect.y + rect.h / 2];
  }
}

function labelFits(cx, cy) {
  const w = 86;
  const h = 20;
  return ![...cardEls.values(), ...frameEls.values()].some((el) => {
    const b = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    return cx - w / 2 < b.x + b.w + 4 && cx + w / 2 > b.x - 4 && cy - h / 2 < b.y + b.h + 4 && cy + h / 2 > b.y - 4;
  });
}

export function vineGeometry(v) {
  const a = rectOf(v.from);
  const b = rectOf(v.to);
  if (!a || !b) return null;
  const [x1, y1] = pinPoint(a, v.fromPin || "right");
  const [x2, y2] = pinPoint(b, v.toPin || "left");
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const n1 = PIN_NORMAL[v.fromPin || "right"];
  const n2 = PIN_NORMAL[v.toPin || "left"];
  let bend = Math.min(200, Math.max(24, dist * 0.45));
  if (Math.abs(n1[0]) === 1 && Math.abs(n2[0]) === 1) bend = Math.min(bend, Math.abs(x2 - x1) * 0.45);
  if (Math.abs(n1[1]) === 1 && Math.abs(n2[1]) === 1) bend = Math.min(bend, Math.abs(y2 - y1) * 0.45);
  bend = Math.max(bend, 12);
  const c1 = [x1 + n1[0] * bend, y1 + n1[1] * bend];
  const c2 = [x2 + n2[0] * bend, y2 + n2[1] * bend];
  const d = `M${x1} ${y1} C${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${x2} ${y2}`;
  const mid = [
    0.125 * x1 + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * x2,
    0.125 * y1 + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * y2,
  ];
  const tx = 0.75 * (c1[0] - x1) + 1.5 * (c2[0] - c1[0]) + 0.75 * (x2 - c2[0]);
  const ty = 0.75 * (c1[1] - y1) + 1.5 * (c2[1] - c1[1]) + 0.75 * (y2 - c2[1]);
  const tl = Math.hypot(tx, ty) || 1;
  const nx = -ty / tl;
  const ny = tx / tl;
  let label = mid;
  for (const d2 of [14, 26, 38]) {
    const cand = [[mid[0] + nx * d2, mid[1] + ny * d2], [mid[0] - nx * d2, mid[1] - ny * d2]];
    const fit = cand.find(([cx, cy]) => labelFits(cx, cy));
    if (fit) { label = fit; break; }
  }
  const ang = Math.atan2(y2 - c2[1], x2 - c2[0]);
  const arm = 8;
  const head =
    `M${x2 - arm * Math.cos(ang - 0.5)} ${y2 - arm * Math.sin(ang - 0.5)}` +
    ` L${x2} ${y2} L${x2 - arm * Math.cos(ang + 0.5)} ${y2 - arm * Math.sin(ang + 0.5)}`;
  return { d, head, label, ends: [[x1, y1], [x2, y2]] };
}

export function pathFromPoints(points) {
  if (!points || points.length < 2) return "";
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

const colorVar = (name) => `var(--pen-${name === "pen" ? "default" : name})`;

function shapeMarkup(s) {
  const stroke = `stroke="${colorVar(s.color)}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  if (s.kind === "rect") {
    return `<rect x="${s.x}" y="${s.y}" width="${Math.max(1, s.w)}" height="${Math.max(1, s.h)}" rx="2" ${stroke} />`;
  }
  if (s.kind === "ellipse") {
    return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.abs(s.w / 2)}" ry="${Math.abs(s.h / 2)}" ${stroke} />`;
  }
  const [a, b] = s.points?.length >= 2 ? s.points : [[s.x, s.y], [s.x + s.w, s.y + s.h]];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const arm = 10 + s.width * 2;
  return `<path d="M${a[0]} ${a[1]} L${b[0]} ${b[1]}" ${stroke} />
    <path d="M${b[0] - arm * Math.cos(ang - 0.42)} ${b[1] - arm * Math.sin(ang - 0.42)} L${b[0]} ${b[1]} L${b[0] - arm * Math.cos(ang + 0.42)} ${b[1] - arm * Math.sin(ang + 0.42)}" ${stroke} />`;
}

function drawWires() {
  let markup = "";
  for (const v of state.vines) {
    const g = vineGeometry(v);
    if (!g) continue;
    const cls = v.kind === "script" ? "is-script" : "";
    const selected = sel.vines.has(v.id) ? " is-selected" : "";
    markup += `<path class="vine-hit" data-vine="${v.id}" d="${g.d}" />`;
    markup += `<path class="vine ${cls}${selected}" d="${g.d}" />`;
    markup += `<path class="vine-head ${cls}${selected}" d="${g.head}" />`;
  }
  for (const s of state.strokes) {
    const d = pathFromPoints(s.points);
    const selected = sel.strokes.has(s.id) ? " is-selected" : "";
    markup += `<path class="stroke-hit" data-stroke="${s.id}" d="${d}" />`;
    markup += `<path class="stroke${selected}" style="stroke:${colorVar(s.color)};stroke-width:${s.width}" d="${d}" />`;
  }
  shapeEls = new Map();
  for (const s of state.shapes) {
    const selected = sel.shapes.has(s.id) ? " is-selected" : "";
    markup += `<g class="shape${selected}" data-shape="${s.id}">${shapeMarkup(s)}</g>`;
  }
  if (guides.length) {
    markup += guides
      .map((g) => `<line class="guide" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" style="stroke-width:${1 / state.viewport.zoom}" />`)
      .join("");
  }
  dom.svg.innerHTML = markup;

  document.querySelectorAll(".vine-label").forEach((l) => l.remove());
  for (const v of state.vines) {
    if (v.kind !== "script" && !v.label) continue;
    const g = vineGeometry(v);
    if (!g) continue;
    const pill = document.createElement("span");
    pill.className = "vine-label";
    pill.dataset.vine = v.id;
    pill.textContent = v.label || t("card.scriptPath");
    pill.style.left = `${g.label[0]}px`;
    pill.style.top = `${g.label[1]}px`;
    dom.world.appendChild(pill);
  }
  drawEndpoints();
  renderHandles();
}

function drawEndpoints() {
  if (sel.vines.size !== 1) return;
  const v = vineById([...sel.vines][0]);
  const g = v && vineGeometry(v);
  if (!g) return;
  g.ends.forEach(([x, y], i) => {
    const dot = document.createElement("span");
    dot.className = "vine-end";
    dot.dataset.end = i === 0 ? "from" : "to";
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dom.world.appendChild(dot);
  });
}

/* ───────────────────────── handles for any single selection ───────────────────────── */

function primaryBox() {
  if (sel.cards.size === 1 && selectionCount() === 1) {
    const c = cardById([...sel.cards][0]);
    if (!c) return null;
    const r = rectOf(c.id);
    return r ? { kind: "card", id: c.id, ...r } : null;
  }
  if (sel.frames.size === 1 && selectionCount() === 1) {
    const f = frameById([...sel.frames][0]);
    return f ? { kind: "frame", id: f.id, x: f.x, y: f.y, w: f.w, h: f.h } : null;
  }
  if (sel.shapes.size === 1 && selectionCount() === 1) {
    const s = shapeById([...sel.shapes][0]);
    return s ? { kind: "shape", id: s.id, x: s.x, y: s.y, w: s.w, h: s.h } : null;
  }
  return null;
}

export function selectionBounds() {
  // selection can outlive a reload; drop ids that no longer exist
  for (const id of [...sel.cards]) if (!cardById(id)) sel.cards.delete(id);
  for (const id of [...sel.frames]) if (!frameById(id)) sel.frames.delete(id);
  for (const id of [...sel.shapes]) if (!shapeById(id)) sel.shapes.delete(id);
  for (const id of [...sel.vines]) if (!vineById(id)) sel.vines.delete(id);
  for (const id of [...sel.strokes]) if (!strokeById(id)) sel.strokes.delete(id);
  const box = primaryBox();
  if (box) return box;
  const boxes = [];
  for (const id of sel.cards) {
    const r = rectOf(id);
    if (r) boxes.push(r);
  }
  for (const id of sel.frames) {
    const f = frameById(id);
    if (f) boxes.push({ x: f.x, y: f.y, w: f.w, h: f.h });
  }
  for (const id of sel.shapes) {
    const s = shapeById(id);
    if (s) boxes.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  }
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { kind: "multi", x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function renderHandles() {
  const box = primaryBox();
  dom.handles.innerHTML = box
    ? HANDLES.map((h) => `<span class="resize-handle is-live" data-h="${h}" data-target="${box.kind}:${box.id}" style="left:${box.x}px;top:${box.y}px;--w:${box.w};--h:${box.h}"></span>`).join("")
    : "";
  if (box) positionHandles(box);
}

function positionHandles(box) {
  const pts = {
    nw: [box.x, box.y], n: [box.x + box.w / 2, box.y], ne: [box.x + box.w, box.y],
    e: [box.x + box.w, box.y + box.h / 2], se: [box.x + box.w, box.y + box.h],
    s: [box.x + box.w / 2, box.y + box.h], sw: [box.x, box.y + box.h], w: [box.x, box.y + box.h / 2],
  };
  dom.handles.querySelectorAll(".resize-handle").forEach((el) => {
    const [x, y] = pts[el.dataset.h];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
}

/* ───────────────────────── viewport ───────────────────────── */

export function applyTransform() {
  const { x, y, zoom } = state.viewport;
  const root = document.documentElement.style;
  root.setProperty("--pan-x", `${x}px`);
  root.setProperty("--pan-y", `${y}px`);
  root.setProperty("--zoom", String(zoom));
  root.setProperty("--grid-size", `${24 * zoom}px`);
  root.setProperty("--grid-x", `${x}px`);
  root.setProperty("--grid-y", `${y}px`);
  root.setProperty("--grid-fade", String(zoom >= 0.55 ? 1 : Math.max(0, (zoom - 0.2) / 0.35)));
  const badge = $("#zoom-btn");
  if (badge) badge.textContent = `${Math.round(zoom * 100)}%`;
}

export function toWorld(clientX, clientY) {
  const r = dom.viewport.getBoundingClientRect();
  return {
    x: (clientX - r.left - state.viewport.x) / state.viewport.zoom,
    y: (clientY - r.top - state.viewport.y) / state.viewport.zoom,
  };
}

export const toScreen = (wx, wy) => ({
  x: wx * state.viewport.zoom + state.viewport.x,
  y: wy * state.viewport.zoom + state.viewport.y,
});

export function zoomAt(clientX, clientY, nextZoom, { save = true } = {}) {
  const zoom = clamp(nextZoom, 0.2, 2.5);
  const r = dom.viewport.getBoundingClientRect();
  const px = clientX - r.left;
  const py = clientY - r.top;
  const wx = (px - state.viewport.x) / state.viewport.zoom;
  const wy = (py - state.viewport.y) / state.viewport.zoom;
  state.viewport = { zoom, x: px - wx * zoom, y: py - wy * zoom };
  applyTransform();
  renderMinimap();
  if (save) markViewportDirty();
}

export function bounds() {
  const xs = [];
  const ys = [];
  for (const c of state.cards) {
    const r = rectOf(c.id) || { x: c.x, y: c.y, w: c.w, h: c.h || 120 };
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  for (const f of state.frames) {
    xs.push(f.x, f.x + f.w);
    ys.push(f.y, f.y + f.h);
  }
  for (const s of state.shapes) {
    xs.push(s.x, s.x + s.w);
    ys.push(s.y, s.y + s.h);
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function fitAll() {
  const b = bounds();
  if (!b) {
    state.viewport = { x: 0, y: 0, zoom: 1 };
    applyTransform();
    renderMinimap();
    markViewportDirty();
    return;
  }
  const pad = 80;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const zoom = clamp(Math.min((vw - pad * 2) / (b.x1 - b.x0), (vh - pad * 2) / (b.y1 - b.y0)), 0.2, 1.2);
  state.viewport = { zoom, x: vw / 2 - ((b.x0 + b.x1) / 2) * zoom, y: vh / 2 - ((b.y0 + b.y1) / 2) * zoom };
  applyTransform();
  renderMinimap();
  markViewportDirty();
}

export function centerOn(wx, wy, zoom = state.viewport.zoom) {
  state.viewport = { zoom, x: window.innerWidth / 2 - wx * zoom, y: window.innerHeight / 2 - wy * zoom };
  applyTransform();
  renderMinimap();
  markViewportDirty();
}

export function focusCard(id, pulse = true) {
  const r = rectOf(id);
  const card = cardById(id);
  if (!r || !card) return;
  const zoom = clamp(state.viewport.zoom, 0.6, 1);
  centerOn(r.x + r.w / 2, r.y + r.h / 2, zoom);
  selectOnly(id);
  if (pulse) {
    const el = cardEls.get(id);
    el?.classList.add("pulse");
    setTimeout(() => el?.classList.remove("pulse"), 650);
  }
}

/* ───────────────────────── minimap ───────────────────────── */

export function renderMinimap() {
  const svg = $("#minimap-svg");
  if (!svg) return;
  const W = 132;
  const H = 84;
  const pad = 7;
  const b = bounds() || { x0: 0, y0: 0, x1: 900, y1: 600 };
  const vx = -state.viewport.x / state.viewport.zoom;
  const vy = -state.viewport.y / state.viewport.zoom;
  const vw = window.innerWidth / state.viewport.zoom;
  const vh = window.innerHeight / state.viewport.zoom;
  const x0 = Math.min(b.x0, vx) - 40;
  const y0 = Math.min(b.y0, vy) - 40;
  const x1 = Math.max(b.x1, vx + vw) + 40;
  const y1 = Math.max(b.y1, vy + vh) + 40;
  const scale = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0));
  const tint = (t) => `var(--tint-${TINTS[t] || "text-muted"})`;
  const parts = state.cards.map((c) => {
    const r = rectOf(c.id) || { x: c.x, y: c.y, w: c.w, h: c.h || 100 };
    return `<rect x="${pad + (r.x - x0) * scale}" y="${pad + (r.y - y0) * scale}"
      width="${Math.max(2, r.w * scale)}" height="${Math.max(2, r.h * scale)}" rx="1"
      fill="${tint(c.type)}" opacity="0.45" />`;
  });
  parts.push(
    `<rect x="${pad + (vx - x0) * scale}" y="${pad + (vy - y0) * scale}"
      width="${vw * scale}" height="${vh * scale}" fill="none" stroke="var(--accent)" stroke-width="1" />`,
  );
  svg.innerHTML = parts.join("");
}

/* ───────────────────────── selection ───────────────────────── */

function paintSelection() {
  for (const [id, el] of cardEls) el.classList.toggle("is-selected", sel.cards.has(id));
  for (const [id, el] of frameEls) el.classList.toggle("is-selected", sel.frames.has(id));
  drawWires();
  hooks.onChange("selection");
}

export function selectOnly(id, type = "cards") {
  clearSelection();
  sel[type].add(id);
  paintSelection();
}

export function selectAll() {
  clearSelection();
  state.cards.forEach((c) => sel.cards.add(c.id));
  paintSelection();
}

export function selectMany(ids) {
  clearSelection();
  ids.forEach((id) => sel.cards.add(id));
  paintSelection();
}

export function deleteSelection({ silent = false } = {}) {
  if (isEmptySelection()) return null;
  const removed = {
    cards: [...sel.cards].map(cardById).filter(Boolean),
    vines: state.vines.filter((v) => sel.vines.has(v.id) || sel.cards.has(v.from) || sel.cards.has(v.to)),
    frames: state.frames.filter((f) => sel.frames.has(f.id)),
    strokes: state.strokes.filter((s) => sel.strokes.has(s.id)),
    shapes: state.shapes.filter((s) => sel.shapes.has(s.id)),
  };
  state.cards = state.cards.filter((c) => !sel.cards.has(c.id));
  state.vines = state.vines.filter((v) => !removed.vines.includes(v));
  state.frames = state.frames.filter((f) => !sel.frames.has(f.id));
  state.strokes = state.strokes.filter((s) => !sel.strokes.has(s.id));
  state.shapes = state.shapes.filter((s) => !sel.shapes.has(s.id));
  clearSelection();
  if (!silent) commit("delete");
  return removed;
}

/* ───────────────────────── clipboard ───────────────────────── */

export function copySelection() {
  const cards = state.cards.filter((c) => sel.cards.has(c.id)).map((c) => JSON.parse(JSON.stringify(c)));
  const ids = new Set(cards.map((c) => c.id));
  const vines = state.vines.filter((v) => ids.has(v.from) && ids.has(v.to)).map((v) => JSON.parse(JSON.stringify(v)));
  clipboard = { cards, vines };
  return clipboard;
}

export function clipboardPayload() {
  if (!clipboard.cards?.length) return null;
  return { bloom: 1, kind: "bloom/cards", cards: clipboard.cards, vines: clipboard.vines };
}

export async function copyToSystem() {
  const payload = clipboardPayload();
  if (!payload) return 0;
  const text = payload.cards.map((c) => primaryText(c) || "").filter(Boolean).join("\n\n");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(JSON.stringify(payload));
    }
  } catch (err) {
    /* clipboard may be denied; internal clipboard still works */
  }
  return { cards: payload.cards.length, vines: payload.vines.length, text };
}

export function pasteInternal(world, { offset = 24 } = {}) {
  if (!clipboard.cards?.length) return 0;
  const base = world || lastWorld;
  const boundsBox = clipboard.cards.reduce(
    (acc, c) => ({ x0: Math.min(acc.x0, c.x), y0: Math.min(acc.y0, c.y), x1: Math.max(acc.x1, c.x + c.w), y1: Math.max(acc.y1, c.y + (c.h || 120)) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const dx = world ? base.x - boundsBox.x0 : offset;
  const dy = world ? base.y - boundsBox.y0 : offset;
  const idMap = new Map();
  const copies = clipboard.cards.map((c) => {
    const id = uid(c.type.slice(0, 2));
    idMap.set(c.id, id);
    return { ...JSON.parse(JSON.stringify(c)), id, x: Math.round(c.x + dx), y: Math.round(c.y + dy), z: nextZ() };
  });
  const newVines = (clipboard.vines || []).map((v) => ({ ...v, id: uid("v"), from: idMap.get(v.from), to: idMap.get(v.to) }));
  state.cards.push(...copies);
  state.vines.push(...newVines);
  clearSelection();
  copies.forEach((c) => sel.cards.add(c.id));
  commit("paste");
  return { cards: copies.length, vines: newVines.length };
}

export function duplicateSelection() {
  if (!copySelection().cards.length) return 0;
  return pasteInternal(null, { offset: 24 });
}

/* ───────────────────────── creation ───────────────────────── */

export function insertCard(type, at, { commitLabel = "create" } = {}) {
  const p = at || lastWorld;
  const card = makeCard(type, snapValue(p.x), snapValue(p.y));
  state.cards.push(card);
  clearSelection();
  sel.cards.add(card.id);
  commit(commitLabel);
  const el = cardEls.get(card.id);
  const focusable = el?.querySelector("[contenteditable]");
  if (focusable) {
    focusable.focus();
    const range = document.createRange();
    range.selectNodeContents(focusable);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }
  return card;
}

export function insertFrame(at) {
  const p = at || lastWorld;
  const frame = { id: uid("f"), label: t("card.frameN", { n: state.frames.length + 1 }), x: Math.round(p.x), y: Math.round(p.y), w: 420, h: 320 };
  state.frames.push(frame);
  clearSelection();
  sel.frames.add(frame.id);
  commit("create");
  return frame;
}

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
  state.vines.push(vine);
  commit("connect");
  return vine;
}

export function addVineFromSelection() {
  const ids = [...sel.cards];
  if (ids.length < 2) return null;
  return connect(ids[1], ids[0], "right");
}

/* ───────────────────────── arrangement ───────────────────────── */

export function align(kind) {
  const box = selectionBounds();
  if (!box) return;
  const items = selectedMovable();
  if (items.length < 2) return;
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  for (const item of items) {
    if (kind === "left") item.x = x0;
    if (kind === "center") item.x = (x0 + x1) / 2 - item.w / 2;
    if (kind === "right") item.x = x1 - item.w;
    if (kind === "top") item.y = y0;
    if (kind === "middle") item.y = (y0 + y1) / 2 - item.h / 2;
    if (kind === "bottom") item.y = y1 - item.h;
    applyBox(item);
  }
  commit("align");
}

export function distribute(axis) {
  const items = selectedMovable();
  if (items.length < 3) return;
  const sorted = [...items].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const total = sorted.reduce((n, i) => n + (axis === "x" ? i.w : i.h), 0);
  const span = axis === "x" ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (sorted.length - 1);
  let cursor = axis === "x" ? first.x : first.y;
  for (const item of sorted) {
    if (axis === "x") item.x = Math.round(cursor);
    else item.y = Math.round(cursor);
    cursor += (axis === "x" ? item.w : item.h) + gap;
    applyBox(item);
  }
  commit("distribute");
}

export function groupIntoFrame() {
  const box = selectionBounds();
  if (!box) return null;
  const pad = 32;
  const frame = {
    id: uid("f"),
    label: t("card.frameN", { n: state.frames.length + 1 }),
    x: Math.round(box.x - pad),
    y: Math.round(box.y - pad - 8),
    w: Math.round(box.w + pad * 2),
    h: Math.round(box.h + pad * 2),
  };
  state.frames.push(frame);
  clearSelection();
  sel.frames.add(frame.id);
  commit("group");
  return frame;
}

function selectedMovable() {
  const items = [];
  for (const id of sel.cards) {
    const c = cardById(id);
    if (c) {
      const r = rectOf(id) || { w: c.w, h: c.h || 120 };
      items.push({ type: "card", ref: c, x: c.x, y: c.y, w: r.w, h: r.h });
    }
  }
  for (const id of sel.frames) {
    const f = frameById(id);
    if (f) items.push({ type: "frame", ref: f, x: f.x, y: f.y, w: f.w, h: f.h });
  }
  for (const id of sel.shapes) {
    const s = shapeById(id);
    if (s) items.push({ type: "shape", ref: s, x: s.x, y: s.y, w: s.w, h: s.h });
  }
  return items;
}

function applyBox(item) {
  item.ref.x = Math.round(item.x);
  item.ref.y = Math.round(item.y);
  if (item.type !== "card") {
    item.ref.w = Math.round(item.w);
    item.ref.h = Math.round(item.h);
  }
}

export function zOrder(mode) {
  const ids = [...sel.cards];
  if (!ids.length) return;
  const ordered = [...state.cards].sort((a, b) => (a.z || 0) - (b.z || 0));
  const picked = ordered.filter((c) => ids.includes(c.id));
  const rest = ordered.filter((c) => !ids.includes(c.id));
  let next = rest;
  if (mode === "front") next = [...rest, ...picked];
  else if (mode === "back") next = [...picked, ...rest];
  else if (mode === "forward") {
    for (const c of picked) {
      const i = next.indexOf(c);
      if (i >= 0 && i < next.length - 1) {
        next.splice(i, 1);
        next.splice(i + 1, 0, c);
      }
    }
  } else if (mode === "backward") {
    for (const c of [...picked].reverse()) {
      const i = next.indexOf(c);
      if (i > 0) {
        next.splice(i, 1);
        next.splice(i - 1, 0, c);
      }
    }
  }
  [...next, ...state.cards.filter((c) => !next.includes(c))].forEach((c, i) => (c.z = i + 1));
  commit("order");
}

export function nudge(dx, dy) {
  const items = selectedMovable();
  if (!items.length) return false;
  for (const item of items) {
    item.ref.x += dx;
    item.ref.y += dy;
  }
  commit("move", { coalesce: true });
  return true;
}

/* ───────────────────────── guides ───────────────────────── */

function computeGuides(moving) {
  const targets = [];
  for (const c of state.cards) {
    if (moving.ids.has(c.id)) continue;
    const r = rectOf(c.id);
    if (r) targets.push(r);
  }
  for (const f of state.frames) {
    if (moving.ids.has(f.id)) continue;
    targets.push({ x: f.x, y: f.y, w: f.w, h: f.h });
  }
  const threshold = 6 / state.viewport.zoom;
  const lines = [];
  const box = moving.box;
  const mine = { xs: [box.x, box.x + box.w / 2, box.x + box.w], ys: [box.y, box.y + box.h / 2, box.y + box.h] };
  let snapX = null;
  let snapY = null;
  for (const t of targets) {
    const tx = [t.x, t.x + t.w / 2, t.x + t.w];
    const ty = [t.y, t.y + t.h / 2, t.y + t.h];
    for (const a of mine.xs) {
      for (const b of tx) {
        if (Math.abs(a - b) <= threshold) {
          lines.push({ x1: b, y1: Math.min(box.y, t.y) - 24, x2: b, y2: Math.max(box.y + box.h, t.y + t.h) + 24 });
          if (snapX == null) snapX = b - a;
        }
      }
    }
    for (const a of mine.ys) {
      for (const b of ty) {
        if (Math.abs(a - b) <= threshold) {
          lines.push({ x1: Math.min(box.x, t.x) - 24, y1: b, x2: Math.max(box.x + box.w, t.x + t.w) + 24, y2: b });
          if (snapY == null) snapY = b - a;
        }
      }
    }
  }
  guides = lines.slice(0, 6);
  return { snapX, snapY };
}

/* ───────────────────────── input ───────────────────────── */

function nearestPin(card, worldPoint) {
  const r = rectOf(card.id) || { x: card.x, y: card.y, w: card.w, h: 120 };
  const dx = worldPoint.x - (r.x + r.w / 2);
  const dy = worldPoint.y - (r.y + r.h / 2);
  if (Math.abs(dx / (r.w / 2)) > Math.abs(dy / (r.h / 2))) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

function startCardDrag(e, card) {
  const start = toWorld(e.clientX, e.clientY);
  const ids = sel.cards.has(card.id) ? [...sel.cards] : [card.id];
  drag = {
    kind: "cards",
    start,
    moved: false,
    items: ids.map((id) => cardById(id)).filter(Boolean).map((c) => ({ card: c, x: c.x, y: c.y })),
  };
}

function startFrameDrag(e, frame) {
  const inside = state.cards.filter((c) => {
    const r = rectOf(c.id) || { x: c.x, y: c.y, w: c.w, h: c.h || 100 };
    return r.x + r.w / 2 > frame.x && r.x + r.w / 2 < frame.x + frame.w && r.y + r.h / 2 > frame.y && r.y + r.h / 2 < frame.y + frame.h;
  });
  drag = {
    kind: "frame",
    start: toWorld(e.clientX, e.clientY),
    frame,
    fx: frame.x,
    fy: frame.y,
    cards: inside.map((c) => ({ card: c, x: c.x, y: c.y })),
    moved: false,
  };
}

export function init(callbacks = {}) {
  hooks = { onChange: () => {}, onPinDrop: () => {}, ...callbacks };
  dom = {
    viewport: $("#viewport"),
    world: $("#world"),
    cards: $("#cards"),
    svg: $("#world-svg"),
    handles: $("#handles"),
  };

  on((kind) => {
    if (kind === "board" || kind === "reload") {
      syncCards();
      syncFrames();
      drawWires();
      $("#empty-hint").hidden = state.cards.length + state.frames.length > 0;
      renderMinimap();
    }
    hooks.onChange(kind);
  });

  dom.viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || settings.scrollMode === "zoom") {
        const factor = Math.exp(-e.deltaY * 0.0016);
        zoomAt(e.clientX, e.clientY, state.viewport.zoom * factor);
      } else {
        state.viewport.x -= e.deltaX;
        state.viewport.y -= e.deltaY;
        applyTransform();
        markViewportDirty();
      }
    },
    { passive: false },
  );

  // ── touch: two fingers pinch to zoom and pan together ──
  const touches = new Map();
  let pinch = null;
  dom.viewport.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2) return;
      const [a, b] = [...touches.values()];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        zoom: state.viewport.zoom,
      };
      drag = null;
      dom.viewport.classList.add("is-panning");
    },
    { capture: true },
  );

  dom.viewport.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch || touches.size < 2) return;
      e.preventDefault();
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      zoomAt(mx, my, pinch.zoom * (d / pinch.d), { save: false });
      state.viewport.x += mx - pinch.mx;
      state.viewport.y += my - pinch.my;
      applyTransform();
      markViewportDirty();
    },
    { capture: true },
  );

  const endTouch = (e) => {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    if (touches.size < 2 && pinch) {
      pinch = null;
      dom.viewport.classList.remove("is-panning");
    }
  };
  dom.viewport.addEventListener("pointerup", endTouch, { capture: true });
  dom.viewport.addEventListener("pointercancel", endTouch, { capture: true });

  dom.viewport.addEventListener("pointerdown", (e) => {
    if (pinch) return;
    if (e.button === 1 || spaceDown || tool === "pan") {
      e.preventDefault();
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: state.viewport.x, vy: state.viewport.y };
      dom.viewport.setPointerCapture(e.pointerId);
      dom.viewport.classList.add("is-panning");
      return;
    }
    if (e.button !== 0) return;

    const target = e.target;
    const cardEl = target.closest("[data-card]");
    const frameEl = target.closest("[data-frame]");
    const card = cardEl && cardById(cardEl.dataset.card);
    const world = toWorld(e.clientX, e.clientY);
    lastWorld = world;

    if (target.isContentEditable) return;

    const envEnd = target.closest("[data-end]");
    if (envEnd && sel.vines.size === 1) {
      e.preventDefault();
      const v = vineById([...sel.vines][0]);
      drag = { kind: "vine-end", vine: v, end: envEnd.dataset.end, world };
      dom.viewport.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "eraser") {
      e.preventDefault();
      eraseAt(world);
      return;
    }

    if (tool === "pen" || tool === "rect" || tool === "ellipse" || tool === "arrow") {
      e.preventDefault();
      if (tool === "pen") {
        drag = { kind: "pen", points: [[world.x, world.y]] };
      } else {
        drag = { kind: "shape", shapeKind: tool, start: world, world };
      }
      dom.viewport.setPointerCapture(e.pointerId);
      return;
    }

    const pin = target.closest("[data-pin]");
    if (pin && card) {
      e.preventDefault();
      drag = { kind: "pin", from: card.id, fromPin: pin.dataset.pin, to: world };
      dom.viewport.setPointerCapture(e.pointerId);
      return;
    }

    const handle = target.closest(".resize-handle");
    if (handle) {
      const [kind, id] = (handle.dataset.target || "").split(":");
      e.preventDefault();
      startResize(kind, id, handle.dataset.h, world);
      dom.viewport.setPointerCapture(e.pointerId);
      return;
    }

    if (card) {
      if (e.ctrlKey || e.metaKey) {
        sel.cards.has(card.id) ? sel.cards.delete(card.id) : sel.cards.add(card.id);
        paintSelection();
      } else if (e.shiftKey) {
        sel.cards.has(card.id) ? sel.cards.delete(card.id) : sel.cards.add(card.id);
        paintSelection();
      } else if (!sel.cards.has(card.id)) {
        selectOnly(card.id);
      }
      e.preventDefault();
      cardEl.focus({ preventScroll: true });
      card.z = nextZ();
      startCardDrag(e, card);
      dom.viewport.setPointerCapture(e.pointerId);
      return;
    }

    const shapeEl = target.closest("[data-shape]");
    if (shapeEl) {
      const s = shapeById(shapeEl.dataset.shape);
      if (s) {
        if (e.shiftKey || e.ctrlKey) {
          sel.shapes.has(s.id) ? sel.shapes.delete(s.id) : sel.shapes.add(s.id);
          paintSelection();
        } else {
          selectOnly(s.id, "shapes");
        }
        e.preventDefault();
        drag = { kind: "shape-move", items: [...sel.shapes].map(shapeById).filter(Boolean).map((sh) => ({ sh, x: sh.x, y: sh.y })), start: world };
        dom.viewport.setPointerCapture(e.pointerId);
        return;
      }
    }

    if (frameEl) {
      const f = frameById(frameEl.dataset.frame);
      const nearEdge = f && Math.min(Math.abs(world.x - f.x), Math.abs(world.x - (f.x + f.w)), Math.abs(world.y - f.y), Math.abs(world.y - (f.y + f.h))) < 12;
      if (f && (nearEdge || target.closest(".frame-label"))) {
        e.preventDefault();
        selectOnly(f.id, "frames");
        startFrameDrag(e, f);
        dom.viewport.setPointerCapture(e.pointerId);
        return;
      }
    }

    const strokeHit = target.closest("[data-stroke]");
    if (strokeHit) {
      selectOnly(strokeHit.dataset.stroke, "strokes");
      return;
    }
    const vineHit = target.closest("[data-vine]");
    if (vineHit) {
      selectOnly(vineHit.dataset.vine, "vines");
      return;
    }

    e.preventDefault();
    if (!e.shiftKey) {
      clearSelection();
      paintSelection();
    }
    if (state.cards.length + state.frames.length === 0) {
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: state.viewport.x, vy: state.viewport.y };
      dom.viewport.classList.add("is-panning");
    } else {
      drag = { kind: "box", sx: e.clientX, sy: e.clientY, additive: e.shiftKey, base: { cards: new Set(sel.cards), vines: new Set(sel.vines), strokes: new Set(sel.strokes), shapes: new Set(sel.shapes) } };
      const marquee = document.createElement("div");
      marquee.className = "marquee";
      dom.viewport.appendChild(marquee);
      drag.el = marquee;
    }
    dom.viewport.setPointerCapture(e.pointerId);
  });

  dom.viewport.addEventListener("pointermove", (e) => {
    const world = toWorld(e.clientX, e.clientY);
    if (!drag) {
      lastWorld = world;
      return;
    }
    if (drag.kind === "pan") {
      state.viewport.x = drag.vx + (e.clientX - drag.sx);
      state.viewport.y = drag.vy + (e.clientY - drag.sy);
      applyTransform();
      return;
    }
    if (drag.kind === "cards") {
      let dx = world.x - drag.start.x;
      let dy = world.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
      const first = drag.items[0]?.card;
      if (first && drag.items.length === 1) {
        const r = rectOf(first.id) || { w: first.w, h: 120 };
        const g = computeGuides({ ids: new Set([first.id]), box: { x: drag.items[0].x + dx, y: drag.items[0].y + dy, w: r.w, h: r.h } });
        if (g.snapX != null) dx += g.snapX;
        if (g.snapY != null) dy += g.snapY;
      } else {
        guides = [];
      }
      for (const item of drag.items) {
        item.card.x = snapValue(item.x + dx);
        item.card.y = snapValue(item.y + dy);
      }
      syncCards();
      drawWires();
      renderMinimap();
      return;
    }
    if (drag.kind === "frame") {
      const dx = world.x - drag.start.x;
      const dy = world.y - drag.start.y;
      drag.moved = true;
      drag.frame.x = snapValue(drag.fx + dx);
      drag.frame.y = snapValue(drag.fy + dy);
      for (const item of drag.cards) {
        item.card.x = snapValue(item.x + dx);
        item.card.y = snapValue(item.y + dy);
      }
      syncFrames();
      syncCards();
      drawWires();
      renderMinimap();
      return;
    }
    if (drag.kind === "resize") {
      resizeTo(world, e.shiftKey);
      return;
    }
    if (drag.kind === "shape-move") {
      const dx = world.x - drag.start.x;
      const dy = world.y - drag.start.y;
      for (const item of drag.items) {
        item.sh.x = snapValue(item.x + dx);
        item.sh.y = snapValue(item.y + dy);
      }
      drawWires();
      return;
    }
    if (drag.kind === "box") {
      const r = dom.viewport.getBoundingClientRect();
      const x0 = Math.min(drag.sx, e.clientX) - r.left;
      const y0 = Math.min(drag.sy, e.clientY) - r.top;
      const x1 = Math.max(drag.sx, e.clientX) - r.left;
      const y1 = Math.max(drag.sy, e.clientY) - r.top;
      Object.assign(drag.el.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      const a = toWorld(Math.min(drag.sx, e.clientX), Math.min(drag.sy, e.clientY));
      const b = toWorld(Math.max(drag.sx, e.clientX), Math.max(drag.sy, e.clientY));
      if (!drag.additive) {
        sel.cards.clear();
        sel.vines.clear();
        sel.strokes.clear();
        sel.shapes.clear();
      } else {
        sel.cards = new Set(drag.base.cards);
        sel.vines = new Set(drag.base.vines);
        sel.strokes = new Set(drag.base.strokes);
        sel.shapes = new Set(drag.base.shapes);
      }
      for (const c of state.cards) {
        const rr = rectOf(c.id) || { x: c.x, y: c.y, w: c.w, h: c.h || 100 };
        if (rr.x < b.x && rr.x + rr.w > a.x && rr.y < b.y && rr.y + rr.h > a.y) sel.cards.add(c.id);
      }
      for (const s of state.shapes) {
        if (s.x < b.x && s.x + s.w > a.x && s.y < b.y && s.y + s.h > a.y) sel.shapes.add(s.id);
      }
      for (const v of state.vines) {
        const g = vineGeometry(v);
        if (!g) continue;
        const yes = g.ends.every(([x, y]) => x > a.x && x < b.x && y > a.y && y < b.y);
        if (yes) sel.vines.add(v.id);
      }
      for (const s of state.strokes) {
        const yes = s.points?.length && s.points.every(([x, y]) => x > a.x && x < b.x && y > a.y && y < b.y);
        if (yes) sel.strokes.add(s.id);
      }
      paintSelection();
      return;
    }
    if (drag.kind === "pin") {
      drag.to = world;
      const el = cardEls.get(drag.from);
      if (el) {
        const a = pinPoint({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }, drag.fromPin);
        dom.svg.innerHTML = `<path class="vine is-preview" d="M${a[0]} ${a[1]} C${a[0] + 40} ${a[1]}, ${world.x - 40} ${world.y}, ${world.x} ${world.y}" />`;
      }
      return;
    }
    if (drag.kind === "vine-end") {
      const v = drag.vine;
      const g = vineGeometry(v);
      if (g) {
        const target = drag.end === "from" ? g.ends[1] : g.ends[0];
        dom.svg.innerHTML = `<path class="vine is-preview" d="M${target[0]} ${target[1]} C${target[0] + 40} ${target[1]}, ${world.x - 40} ${world.y}, ${world.x} ${world.y}" />`;
      }
      return;
    }
    if (drag.kind === "pen") {
      const last = drag.points[drag.points.length - 1];
      if (Math.hypot(world.x - last[0], world.y - last[1]) > 2.5) {
        drag.points.push([world.x, world.y]);
        dom.svg.innerHTML = `<path class="stroke is-preview" style="stroke:${colorVar(pen.color)};stroke-width:${pen.width}" d="${pathFromPoints(drag.points)}" />`;
      }
      return;
    }
    if (drag.kind === "shape") {
      drag.w = world.x - drag.start.x;
      drag.h = world.y - drag.start.y;
      const s = makeShape(drag.shapeKind, drag.start.x, drag.start.y, drag.w, drag.h, pen);
      if (drag.shapeKind === "arrow") s.points = [[drag.start.x, drag.start.y], [world.x, world.y]];
      dom.svg.innerHTML = shapeMarkup(s);
      return;
    }
  });

  dom.viewport.addEventListener("pointerup", (e) => {
    const world = toWorld(e.clientX, e.clientY);
    if (!drag) return;
    const kind = drag.kind;

    if (kind === "pan") {
      dom.viewport.classList.remove("is-panning");
      markViewportDirty();
      renderMinimap();
    } else if (kind === "cards" && drag.moved) {
      commit("move");
    } else if (kind === "frame" && drag.moved) {
      commit("move-frame");
    } else if (kind === "resize") {
      commit("resize");
    } else if (kind === "shape-move") {
      commit("move");
    } else if (kind === "box") {
      drag.el?.remove();
      hooks.onChange("selection");
    } else if (kind === "pin") {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card]");
      const toId = el?.dataset.card;
      if (toId && toId !== drag.from) {
        const toCard = cardById(toId);
        state.vines.push({ id: uid("v"), from: drag.from, fromPin: drag.fromPin, to: toId, toPin: nearestPin(toCard, world), kind: "vine" });
        commit("connect");
      } else if (Math.hypot(world.x - drag.to.x, world.y - drag.to.y) > 4) {
        hooks.onPinDrop(world, { from: drag.from, fromPin: drag.fromPin });
      }
      drawWires();
    } else if (kind === "vine-end") {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card]");
      if (el && el.dataset.card !== drag.vine.from && el.dataset.card !== drag.vine.to) {
        const card = cardById(el.dataset.card);
        if (drag.end === "from") {
          drag.vine.from = el.dataset.card;
          drag.vine.fromPin = nearestPin(card, world);
        } else {
          drag.vine.to = el.dataset.card;
          drag.vine.toPin = nearestPin(card, world);
        }
        commit("reconnect");
      } else {
        drawWires();
      }
    } else if (kind === "pen") {
      if (drag.points.length > 1) {
        state.strokes.push({ id: uid("s"), color: pen.color, width: pen.width, points: drag.points });
        commit("draw");
      } else {
        drawWires();
      }
    } else if (kind === "shape") {
      if (Math.abs(drag.w) > 6 || Math.abs(drag.h) > 6) {
        const s = makeShape(drag.shapeKind, Math.min(drag.start.x, world.x), Math.min(drag.start.y, world.y), Math.abs(drag.w), Math.abs(drag.h), pen);
        if (drag.shapeKind === "arrow") s.points = [[drag.start.x, drag.start.y], [world.x, world.y]];
        state.shapes.push(s);
        clearSelection();
        sel.shapes.add(s.id);
        commit("shape");
      } else {
        drawWires();
      }
    }
    guides = [];
    drag = null;
  });

  dom.viewport.addEventListener("pointercancel", () => {
    if (drag && drag.moved && ["cards", "frame", "resize", "shape-move"].includes(drag.kind)) {
      commit(drag.kind === "resize" ? "resize" : "move");
    }
    drag = null;
    guides = [];
    dom.viewport.classList.remove("is-panning");
  });

  /* text + controls */
  dom.viewport.addEventListener("input", (e) => {
    const field = e.target.dataset.field;
    const item = e.target.dataset.item;
    const cardEl = e.target.closest("[data-card]");
    if (cardEl && (field || item)) {
      const card = cardById(cardEl.dataset.card);
      if (!card) return;
      if (card.placeholder) delete card.placeholder;
      if (item) {
        const t = (card.items || []).find((x) => x.id === item);
        if (t) t.text = e.target.textContent;
      } else {
        card[field] = e.target.textContent;
      }
      if (card.type === "script" && field === "text") {
        const foot = cardEl.querySelector(".foot");
        if (foot) foot.textContent = t("script.words", { n: words(card.text), s: secondsFor(words(card.text)) });
      }
      cardEl.dataset.sig = sigOf(card);
      cardEl.dataset.aria = "";
      commit("edit", { coalesce: true });
      return;
    }
  });

  /* plain-text paste everywhere */
  dom.viewport.addEventListener("paste", (e) => {
    const host = e.target.closest("[contenteditable]");
    if (!host) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    e.preventDefault();
    const selRange = window.getSelection();
    if (!selRange.rangeCount) return;
    selRange.deleteFromDocument();
    const node = document.createTextNode(text);
    selRange.getRangeAt(0).insertNode(node);
    selRange.collapseToEnd();
    host.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });

  dom.viewport.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    const cardEl = e.target.closest("[data-card]");
    if (act && cardEl) {
      const card = cardById(cardEl.dataset.card);
      if (!card) return;
      if (act.dataset.act === "style") {
        const i = HOOK_STYLES.indexOf(card.style);
        card.style = HOOK_STYLES[(i + 1) % HOOK_STYLES.length];
        commit("style");
      }
      if (act.dataset.act === "status") {
        const order = ["needed", "shot", "have"];
        card.status = order[(order.indexOf(card.status) + 1) % order.length];
        commit("status");
      }
      if (act.dataset.act === "choose") {
        card.chosen = act.dataset.title;
        commit("title");
      }
      if (act.dataset.act === "add-title") {
        card.items = card.items || [];
        const item = { id: uid("t"), text: "Another title" };
        card.items.push(item);
        card.chosen = card.chosen || item.id;
        commit("title");
      }
      return;
    }
    const url = e.target.closest("[data-field='url']");
    if (url && cardEl) {
      const card = cardById(cardEl.dataset.card);
      if (card?.url && /^https?:\/\//i.test(card.url)) {
        e.preventDefault();
        window.__TAURI__?.core?.invoke?.("open_url", { url: card.url }).catch(() => {});
      }
    }
  });

  dom.viewport.addEventListener("dblclick", (e) => {
    const label = e.target.closest("[data-frame-field='label']");
    if (label) {
      const frameEl = label.closest("[data-frame]");
      const frame = frameById(frameEl.dataset.frame);
      if (frame) {
        startFrameLabelEdit(frameEl, label, frame);
      }
      return;
    }
    const vineLabel = e.target.closest(".vine-label");
    const vine = vineLabel ? vineById(vineLabel.dataset.vine) : null;
    const vinePath = e.target.closest("[data-vine]");
    const targetVine = vine || (vinePath ? vineById(vinePath.dataset.vine) : null);
    if (targetVine) {
      e.preventDefault();
      startVineLabelEdit(targetVine);
      return;
    }
    if (!e.target.closest("[data-card]") && !e.target.closest("[data-frame]") && !e.target.closest("[data-shape]")) {
      hooks.onEmptyDblClick?.(toWorld(e.clientX, e.clientY));
    }
  });

  /* minimap */
  const mm = $("#minimap");
  const scrub = (e) => {
    const r = mm.getBoundingClientRect();
    const b = bounds() || { x0: 0, y0: 0, x1: 900, y1: 600 };
    const pad = 7;
    const W = 132;
    const H = 84;
    const vx = -state.viewport.x / state.viewport.zoom;
    const vy = -state.viewport.y / state.viewport.zoom;
    const vw = window.innerWidth / state.viewport.zoom;
    const vh = window.innerHeight / state.viewport.zoom;
    const x0 = Math.min(b.x0, vx) - 40;
    const y0 = Math.min(b.y0, vy) - 40;
    const x1 = Math.max(b.x1, vx + vw) + 40;
    const y1 = Math.max(b.y1, vy + vh) + 40;
    const scale = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0));
    centerOn((e.clientX - r.left - pad) / scale + x0, (e.clientY - r.top - pad) / scale + y0);
  };
  mm.addEventListener("pointerdown", (e) => {
    mm.setPointerCapture(e.pointerId);
    scrub(e);
    const move = (ev) => scrub(ev);
    const up = () => {
      mm.removeEventListener("pointermove", move);
      mm.removeEventListener("pointerup", up);
    };
    mm.addEventListener("pointermove", move);
    mm.addEventListener("pointerup", up);
  });

  dom.viewport.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.isContentEditable) return;
    const cardEl = e.target.closest("[data-card]");
    if (!cardEl) return;
    const field = cardEl.querySelector("[contenteditable]");
    if (field) {
      e.preventDefault();
      field.focus();
      const range = document.createRange();
      range.selectNodeContents(field);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.isContentEditable) {
      spaceDown = true;
      dom.viewport.classList.add("is-panning");
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spaceDown = false;
      dom.viewport.classList.remove("is-panning");
    }
  });
  window.addEventListener("resize", () => {
    applyTransform();
    renderMinimap();
  });
}

/* ───────────────────────── resize ───────────────────────── */

let resizeState = null;

function startResize(kind, id, dir, world) {
  if (kind === "card") {
    const c = cardById(id);
    const r = rectOf(id);
    resizeState = { kind, ref: c, dir, start: world, x: c.x, y: c.y, w: r?.w || c.w, h: r?.h || c.h || 120 };
  } else if (kind === "frame") {
    const f = frameById(id);
    resizeState = { kind, ref: f, dir, start: world, x: f.x, y: f.y, w: f.w, h: f.h };
  } else {
    const s = shapeById(id);
    resizeState = { kind, ref: s, dir, start: world, x: s.x, y: s.y, w: s.w, h: s.h };
  }
  drag = { kind: "resize" };
}

function resizeTo(world, free = false) {
  if (!resizeState) return;
  const { dir, start } = resizeState;
  const dx = world.x - start.x;
  const dy = world.y - start.y;
  const minW = resizeState.kind === "frame" ? 120 : 80;
  const minH = resizeState.kind === "frame" ? 80 : 60;
  let { x, y, w, h } = resizeState;
  if (dir.includes("e")) w = Math.max(minW, resizeState.w + dx);
  if (dir.includes("s")) h = Math.max(minH, resizeState.h + dy);
  if (dir.includes("w")) {
    w = Math.max(minW, resizeState.w - dx);
    x = resizeState.x + (resizeState.w - w);
  }
  if (dir.includes("n")) {
    h = Math.max(minH, resizeState.h - dy);
    y = resizeState.y + (resizeState.h - h);
  }
  const ref = resizeState.ref;
  ref.x = snapValue(x);
  ref.y = snapValue(y);
  ref.w = snapValue(w);
  if (resizeState.kind === "card") {
    ref.h = snapValue(h);
    if (ref.type === "image" && ref.image && !free) {
      const ratio = ref.image.width / ref.image.height || 1;
      ref.h = Math.round(ref.w / ratio);
    }
  } else {
    ref.h = snapValue(h);
  }
  syncCards();
  syncFrames();
  drawWires();
}

/* ───────────────────────── text editors ───────────────────────── */

function startFrameLabelEdit(frameEl, labelEl, frame) {
  const input = document.createElement("input");
  input.className = "inline-edit frame-edit";
  input.value = frame.label;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  const commitLabel = () => {
    frame.label = input.value.trim() || t("card.frame");
    input.remove();
    syncFrames();
    commit("frame-label");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitLabel();
    }
    if (e.key === "Escape") {
      input.value = frame.label;
      commitLabel();
    }
  });
  input.addEventListener("blur", commitLabel);
}

function startVineLabelEdit(vine) {
  const g = vineGeometry(vine);
  if (!g) return;
  const input = document.createElement("input");
  input.className = "inline-edit vine-edit";
  input.value = vine.label || (vine.kind === "script" ? t("card.scriptPath") : "");
  input.placeholder = "Label";
  input.style.left = `${g.label[0]}px`;
  input.style.top = `${g.label[1]}px`;
  dom.world.appendChild(input);
  input.focus();
  input.select();
  const done = () => {
    vine.label = input.value.trim();
    input.remove();
    drawWires();
    commit("vine-label");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      done();
    }
    if (e.key === "Escape") {
      input.value = vine.label || "";
      done();
    }
  });
  input.addEventListener("blur", done);
}

/* ───────────────────────── eraser + misc ───────────────────────── */

function eraseAt(world) {
  const tol = 12 / state.viewport.zoom;
  const hitStrokes = state.strokes.filter((s) =>
    s.points?.some(([x, y]) => Math.abs(x - world.x) < tol && Math.abs(y - world.y) < tol),
  );
  const hitShapes = state.shapes.filter((s) => {
    if (s.kind === "rect" || s.kind === "ellipse") {
      return world.x > s.x - tol && world.x < s.x + s.w + tol && world.y > s.y - tol && world.y < s.y + s.h + tol;
    }
    return s.points?.some(([x, y]) => Math.abs(x - world.x) < tol && Math.abs(y - world.y) < tol);
  });
  if (!hitStrokes.length && !hitShapes.length) return;
  state.strokes = state.strokes.filter((s) => !hitStrokes.includes(s));
  state.shapes = state.shapes.filter((s) => !hitShapes.includes(s));
  commit("erase");
}

export function toggleVineKind(vineId) {
  const v = vineById(vineId);
  if (!v) return;
  v.kind = v.kind === "script" ? "vine" : "script";
  if (v.kind === "script" && !v.label) v.label = "";
  commit("vine-kind");
}

export function setVineLabel(vineId, label) {
  const v = vineById(vineId);
  if (!v) return;
  v.label = label;
  commit("vine-label");
}

export function setTool(next) {
  tool = next;
  ["pen", "eraser", "rect", "ellipse", "arrow", "vine", "pan"].forEach((k) => dom.viewport?.classList.toggle(`tool-${k}`, tool === k));
}

export const getTool = () => tool;
export const setPen = (patch) => {
  pen = { ...pen, ...patch };
  if (patch.kind) tool = patch.kind;
  setTool(tool);
  return pen;
};
export const getPen = () => pen;
export const pointerWorld = () => lastWorld;
export const selectionCount = () =>
  sel.cards.size + sel.vines.size + sel.frames.size + sel.strokes.size + sel.shapes.size;

/* ───────────────────────── render entry ───────────────────────── */

/** Force every card and frame to be rebuilt — used when the locale changes. */
export function invalidateAll() {
  for (const el of cardEls.values()) el.dataset.sig = "";
  for (const el of frameEls.values()) el.dataset.sig = "";
}

export function renderAll() {
  syncCards();
  syncFrames();
  drawWires();
  applyTransform();
  renderMinimap();
  $("#empty-hint").hidden = state.cards.length + state.frames.length > 0;
  hooks.onChange("board");
}

export function redraw() {
  drawWires();
  renderMinimap();
}

export function connectPreviewActive() {
  return drag?.kind === "pin";
}

export function frameElements() {
  return frameEls;
}
