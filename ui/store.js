// Bloom — board state, patch history, dirty-entity persistence, settings.

import { project as seedProject, viewport as seedViewport, frame as seedFrame, cards as seedCards, vines as seedVines, strokes as seedStrokes } from "./sample.js";

const invokeFn = window.__TAURI__?.core?.invoke;
export const invoke = invokeFn ? (cmd, args) => invokeFn(cmd, args) : null;

export const STATUSES = ["Spark", "Outlined", "Scripted", "Filmed", "Edited", "Published"];
export const HOOK_STYLES = ["question", "bold claim", "story", "pattern interrupt"];
export const SNAP_GRID = 8;
export const SHAPE_COLORS = ["pen", "accent", "accent-soft", "shot", "titles", "thumb"];
export const PEN_COLORS = ["pen", "text", "accent", "shot", "titles", "thumb"];
export const PEN_WIDTHS = [1.6, 3, 6];
export const CARD_TYPES = ["idea", "hook", "script", "shot", "titles", "thumbnail", "sticky", "image", "source"];

export const TINTS = {
  idea: "accent", hook: "hook", script: "accent", shot: "shot", titles: "titles",
  thumbnail: "thumb", sticky: "pen", image: "text-2", source: "source",
};

let seq = 0;
export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const state = {
  projectId: null,
  name: "Untitled board",
  status: "Outlined",
  tags: "",
  wpm: 150,
  viewport: { x: 0, y: 0, zoom: 1 },
  cards: [],
  vines: [],
  frames: [],
  strokes: [],
  shapes: [],
  snap: false,
};

export const sel = { cards: new Set(), vines: new Set(), frames: new Set(), strokes: new Set(), shapes: new Set() };

export const settings = {
  wpm: 150,
  snapDefault: false,
  scrollMode: "zoom",
  reduceMotion: false,
  model: "claude-sonnet-5-5",
  hintsSeen: false,
  tpSize: 44,
  tpSpeed: 2,
  tpMirror: false,
  lastProject: "",
};

export function applySettings(patch = {}) {
  Object.assign(settings, patch);
  state.wpm = Number(settings.wpm) || state.wpm || 150;
  state.snap = settings.snapDefault ?? state.snap;
}

export async function loadSettings() {
  try {
    if (invoke) {
      const stored = await invoke("get_settings");
      if (stored && typeof stored === "object") applySettings(stored);
    } else {
      const local = JSON.parse(localStorage.getItem("bloom.settings") || "{}");
      applySettings(local);
    }
  } catch (err) {
    console.warn("settings load failed", err);
  }
  return settings;
}

export async function saveSettings(patch) {
  Object.assign(settings, patch);
  if (patch.wpm) state.wpm = Number(patch.wpm) || state.wpm;
  try {
    localStorage.setItem("bloom.settings", JSON.stringify(settings));
    if (invoke) await invoke("put_settings", { patch });
  } catch (err) {
    console.warn("settings save failed", err);
  }
}

/* ───────────── selection helpers ───────────── */

export const isEmptySelection = () =>
  !sel.cards.size && !sel.vines.size && !sel.frames.size && !sel.strokes.size && !sel.shapes.size;

export function clearSelection() {
  Object.values(sel).forEach((set) => set.clear());
}

export const selectionCount = () =>
  Object.values(sel).reduce((n, s) => n + s.size, 0);

/* ───────────── factories ───────────── */

const DEFAULTS = {
  idea: () => ({ w: 260, title: "New idea", body: "One line about what this could be." }),
  hook: () => ({ w: 300, style: "bold claim", text: "Say the thing nobody else will say." }),
  script: () => ({ w: 300, section: "Section", text: "Words you will actually say." }),
  shot: () => ({ w: 240, text: "What the camera sees.", status: "needed", tag: "B-roll" }),
  titles: () => ({
    w: 270,
    chosen: null,
    items: [
      { id: uid("t"), text: "First title" },
      { id: uid("t"), text: "Second title" },
      { id: uid("t"), text: "Third title" },
    ],
  }),
  thumbnail: () => ({ w: 240, overlay: "TITLE" }),
  sticky: () => ({ w: 170, rotation: -2, text: "A loose thought." }),
  image: () => ({ w: 300, h: 200, caption: "", image: null }),
  source: () => ({ w: 280, url: "", title: "", quote: "", notes: "" }),
};

export const nextZ = () => state.cards.reduce((m, c) => Math.max(m, c.z || 0), 0) + 1;

export function makeCard(type, x, y, overrides = {}) {
  const base = { id: uid(type.slice(0, 2)), type, x: Math.round(x), y: Math.round(y), z: nextZ() };
  const extra = (DEFAULTS[type] || DEFAULTS.idea)();
  const card = { ...base, ...extra, ...overrides };
  if (type === "titles" && !card.chosen) card.chosen = card.items?.[0]?.id ?? null;
  return card;
}

export function makeShape(kind, x, y, w, h, style = {}) {
  return {
    id: uid("sh"),
    kind,
    color: style.color || "pen",
    width: style.width || 1.6,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    points: style.points || [],
  };
}

export const cardById = (id) => state.cards.find((c) => c.id === id);
export const frameById = (id) => state.frames.find((f) => f.id === id);
export const vineById = (id) => state.vines.find((v) => v.id === id);
export const strokeById = (id) => state.strokes.find((s) => s.id === id);
export const shapeById = (id) => state.shapes.find((s) => s.id === id);

export const wordsLeft = () => {};

export const words = (text) => (String(text || "").trim().match(/\S+/g) || []).length;
export const secondsFor = (n) => (n > 0 ? Math.max(1, Math.round((n / (state.wpm || 150)) * 60)) : 0);
export const clock = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

export function vinesOf(id) {
  return state.vines.filter((v) => v.from === id || v.to === id);
}

export function frameOf(card) {
  return state.frames.find(
    (f) =>
      card.x + card.w / 2 > f.x &&
      card.x + card.w / 2 < f.x + f.w &&
      card.y + 40 > f.y &&
      card.y + 40 < f.y + f.h,
  );
}

/* ───────────── type conversion ───────────── */

const PRIMARY = { idea: "title", hook: "text", script: "text", shot: "text", sticky: "text", titles: "title", thumbnail: "overlay", image: "caption", source: "title" };

export const primaryText = (card) => {
  if (card.type === "titles") return card.items?.find((i) => i.id === card.chosen)?.text || card.items?.[0]?.text || "";
  if (card.type === "image") return card.caption || "";
  const field = PRIMARY[card.type] || "text";
  return card[field] || "";
};

export function convertCardType(card, nextType) {
  if (!card || card.type === nextType || !DEFAULTS[nextType]) return false;
  const stash = { ...(card.extra || {}) };
  const keep = { id: card.id, x: card.x, y: card.y, w: DEFAULTS[nextType]().w || card.w, z: card.z };
  if (card.h) keep.h = card.h;
  if (card.image) keep.image = card.image;
  const current = {};
  for (const key of ["title", "body", "text", "style", "section", "status", "tag", "items", "chosen", "overlay", "caption", "url", "quote", "notes", "rotation", "image"]) {
    if (card[key] !== undefined) current[key] = card[key];
  }
  stash[card.type] = current;

  const next = { ...DEFAULTS[nextType](), ...keep };
  const restored = stash[nextType] || {};
  Object.assign(next, restored);
  const text = primaryText(card);
  const field = PRIMARY[nextType] || "text";
  if (!restored[field]) {
    if (nextType === "titles") next.items = [{ id: uid("t"), text: text || "Title" }, ...(next.items || [])].slice(0, 4);
    else next[field] = text;
  }
  if (stash[nextType]) next.chosen = next.chosen || next.items?.[0]?.id || null;
  delete stash[nextType];
  if (Object.keys(stash).length) next.extra = stash;
  const index = state.cards.findIndex((c) => c.id === card.id);
  if (index >= 0) state.cards[index] = next;
  return true;
}

/* ───────────── script walk ───────────── */

export const labelOf = (card) =>
  card.type === "hook" ? "Hook" : card.type === "script" ? card.section || "Section" : card.type;

export function walkScript() {
  const warnings = [];
  const blocks = [];
  const hooks = state.cards.filter((c) => c.type === "hook");
  const scriptCards = state.cards.filter((c) => c.type === "script");
  let start = hooks[0];
  if (!start) {
    const incoming = new Set(state.vines.filter((v) => v.kind === "script").map((v) => v.to));
    start = scriptCards.find((c) => !incoming.has(c.id));
  }
  if (!start) return { blocks, warnings, offPath: [], start: null };

  const seen = new Set();
  let current = start;
  let guard = 0;
  while (current && guard++ < 500) {
    if (seen.has(current.id)) {
      warnings.push(`The script path loops back to “${labelOf(current)}”.`);
      break;
    }
    seen.add(current.id);
    const out = state.vines.filter((v) => v.kind === "script" && v.from === current.id);
    if (out.length > 1) {
      warnings.push(`“${labelOf(current)}” branches into ${out.length} script paths; only the first is followed.`);
    }
    const frame = frameOf(current);
    const attached = new Set();
    for (const v of vinesOf(current.id)) {
      if (v.kind === "script") continue;
      const other = cardById(v.from === current.id ? v.to : v.from);
      if (other) attached.add(other.id);
    }
    if (frame) {
      for (const c of state.cards) {
        if (c.id !== current.id && frameOf(c)?.id === frame.id) attached.add(c.id);
      }
    }
    blocks.push({ card: current, attached: [...attached].map(cardById).filter(Boolean) });
    current = out.length ? cardById(out[0].to) : null;
  }
  if (guard >= 500) warnings.push("The script path is too long to follow.");
  const offPath = scriptCards.filter((c) => !seen.has(c.id));
  return { blocks, warnings, offPath, start };
}

export function scriptTotals() {
  const { blocks } = walkScript();
  const total = blocks.reduce((n, b) => n + words(b.card.text), 0);
  return { blocks: blocks.length, words: total, seconds: Math.round((total / (state.wpm || 150)) * 60) };
}

/* ───────────── serialisation + dirty tracking ───────────── */

const ENTITIES = ["cards", "vines", "frames", "strokes", "shapes"];

export function serialize() {
  return {
    projectId: state.projectId,
    name: state.name,
    status: state.status,
    tags: state.tags,
    wpm: state.wpm,
    viewport: { ...state.viewport },
    ...Object.fromEntries(ENTITIES.map((k) => [k, state[k]])),
  };
}

const index = { cards: new Map(), vines: new Map(), frames: new Map(), strokes: new Map(), shapes: new Map() };
const dirty = { cards: new Set(), vines: new Set(), frames: new Set(), strokes: new Set(), shapes: new Set() };
const removed = { cards: new Set(), vines: new Set(), frames: new Set(), strokes: new Set(), shapes: new Set() };
let viewportDirty = false;
let wpmDirty = false;

const json = (entity, item) => JSON.stringify(item);

function rebuildIndex() {
  for (const entity of ENTITIES) {
    index[entity].clear();
    for (const item of state[entity]) index[entity].set(item.id, json(entity, item));
    dirty[entity].clear();
    removed[entity].clear();
  }
  viewportDirty = false;
  wpmDirty = false;
}

/** Diff current state against the committed index; returns changed entities. */
function diffAndRecord(ops) {
  for (const entity of ENTITIES) {
    const seen = new Set();
    for (const item of state[entity]) {
      seen.add(item.id);
      const next = json(entity, item);
      const prev = index[entity].get(item.id);
      if (prev !== next) {
        ops.push({ entity, id: item.id, before: prev ?? null, after: next });
        index[entity].set(item.id, next);
        dirty[entity].add(item.id);
        removed[entity].delete(item.id);
      }
    }
    for (const id of [...index[entity].keys()]) {
      if (!seen.has(id)) {
        ops.push({ entity, id, before: index[entity].get(id), after: null });
        index[entity].delete(id);
        removed[entity].add(id);
        dirty[entity].delete(id);
      }
    }
  }
}

/* ───────────── history (entity patches) ───────────── */

let history = [];
let hIndex = -1;
let lastLabel = "";
let lastAt = 0;
let listeners = [];
const UNDO_CAP = 200;

export const on = (fn) => listeners.push(fn);
export const off = (fn) => {
  listeners = listeners.filter((f) => f !== fn);
};
const emit = (kind = "board", detail) => listeners.forEach((fn) => fn(kind, detail));

export function resetHistory() {
  rebuildIndex();
  history = [];
  hIndex = -1;
  lastLabel = "";
  lastAt = 0;
}

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
  // keep the persisted index honest so the next save carries the revert
  for (const entity of dropping) {
    for (const item of state[entity]) {
      const next = json(entity, item);
      if (index[entity].get(item.id) !== next) {
        index[entity].set(item.id, next);
        dirty[entity].add(item.id);
        removed[entity].delete(item.id);
      }
    }
    for (const id of [...index[entity].keys()]) {
      if (!state[entity].some((it) => it.id === id)) {
        index[entity].delete(id);
        removed[entity].add(id);
        dirty[entity].delete(id);
      }
    }
  }
}

export function commit(label = "edit", { coalesce = false, kind = "board", detail } = {}) {
  const ops = [];
  diffAndRecord(ops);
  if (ops.length) {
    const burst = coalesce && label === lastLabel && Date.now() - lastAt < 800 && hIndex >= 0;
    if (burst) {
      history[hIndex].ops.push(...ops);
    } else {
      history = history.slice(0, hIndex + 1);
      history.push({ label, at: Date.now(), ops });
      hIndex = history.length - 1;
      if (history.length > UNDO_CAP) {
        history.shift();
        hIndex--;
      }
    }
    lastLabel = label;
    lastAt = Date.now();
    scheduleSave();
  }
  emit(kind, detail);
  return ops.length;
}

export function undo() {
  if (hIndex < 0) return null;
  const entry = history[hIndex];
  applyPatch(entry.ops, "undo");
  const label = entry.label;
  hIndex--;
  clearSelection();
  scheduleSave();
  emit("reload");
  return label;
}

export function redo() {
  if (hIndex >= history.length - 1) return null;
  hIndex++;
  const entry = history[hIndex];
  applyPatch(entry.ops, "redo");
  clearSelection();
  scheduleSave();
  emit("reload");
  return entry.label;
}

export const historyDepth = () => ({ index: hIndex, length: history.length, label: history[hIndex]?.label || "" });
export const historyList = () => history.map((h, i) => ({ index: i, label: h.label, at: h.at, touched: h.ops.length }));

/* ───────────── persistence ───────────── */

let saveTimer = null;
let saving = null;
const saveListeners = new Set();
export const onSaveState = (fn) => saveListeners.add(fn);
const saveState = (status, detail) => saveListeners.forEach((fn) => fn(status, detail));

const mirror = () => {
  try {
    localStorage.setItem("bloom.board", JSON.stringify(serialize()));
    if (state.projectId) localStorage.setItem("bloom.project", state.projectId);
  } catch (err) {
    /* quota: sqlite is authoritative */
  }
};

export function scheduleSave() {
  mirror();
  saveState("pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 400);
}

function collectChanges() {
  const changes = {};
  let touched = 0;
  for (const entity of ENTITIES) {
    const upsert = [...dirty[entity]]
      .map((id) => state[entity].find((item) => item.id === id))
      .filter(Boolean);
    const del = [...removed[entity]];
    if (upsert.length || del.length) {
      changes[entity] = { upsert, delete: del };
      touched += upsert.length + del.length;
    }
  }
  if (viewportDirty) changes.viewport = { ...state.viewport };
  if (wpmDirty) changes.wpm = state.wpm;
  return { changes, touched };
}

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

export const markViewportDirty = () => {
  viewportDirty = true;
  scheduleSave();
};

export const markWpmDirty = () => {
  wpmDirty = true;
  scheduleSave();
};

/* ───────────── projects ───────────── */

export async function listProjects(includeTrash = false) {
  if (!invoke) return [];
  return invoke("list_projects", { includeTrash });
}

export async function applyBoard(board, { keepViewport = false } = {}) {
  if (!board) return;
  // a debounced save from the previous board must never land on this project
  clearTimeout(saveTimer);
  state.projectId = board.projectId ?? state.projectId;
  state.name = board.name ?? state.name;
  state.status = board.status ?? state.status;
  state.tags = board.tags ?? state.tags;
  state.wpm = board.wpm ?? state.wpm;
  if (!keepViewport) state.viewport = { x: 0, y: 0, zoom: 1, ...(board.viewport || {}) };
  for (const entity of ENTITIES) state[entity] = (board[entity] || []).map((x) => ({ ...x }));
  for (const card of state.cards) card.z = card.z || 0;
  resetHistory();
  // A loaded board is authoritative: mirror every entity so the next save
  // converges on it, and never let a stale index schedule deletes.
  for (const entity of ENTITIES) {
    for (const item of state[entity]) dirty[entity].add(item.id);
    removed[entity].clear();
  }
}

export function sampleBoard() {
  return {
    name: seedProject.name,
    status: seedProject.status,
    tags: "",
    wpm: seedProject.wordsPerMinute || 150,
    viewport: { ...seedViewport },
    cards: seedCards.map((c, i) => ({ z: i, ...c })),
    vines: seedVines.map((v) => ({ ...v })),
    frames: [{ ...seedFrame }],
    strokes: seedStrokes.map((s) => ({ ...s })),
    shapes: [],
  };
}

export async function boot() {
  await loadSettings();
  let board = null;
  if (invoke) {
    try {
      const projects = await listProjects();
      if (!projects.length) {
        const seed = sampleBoard();
        const created = await invoke("create_project", { name: seed.name, seed });
        state.projectId = created.id;
        board = await invoke("load_board", { projectId: created.id });
      } else {
        const wanted = settings.lastProject || localStorage.getItem("bloom.project");
        const project = projects.find((p) => p.id === wanted) || projects[0];
        state.projectId = project.id;
        board = await invoke("load_board", { projectId: project.id });
      }
    } catch (err) {
      console.error("boot: sqlite unavailable", err);
    }
  }
  if (!board) {
    try {
      board = JSON.parse(localStorage.getItem("bloom.board") || "null");
    } catch (err) {
      board = null;
    }
  }
  if (!board) board = sampleBoard();
  await applyBoard(board);
  if (!state.cards.length && !state.vines.length && !state.frames.length) {
    const seed = sampleBoard();
    for (const entity of ENTITIES) state[entity] = seed[entity];
    resetHistory();
  }
  state.snap = settings.snapDefault ?? false;
  return state;
}

export async function setStatus(status) {
  state.status = status;
  if (invoke && state.projectId) invoke("set_project_status", { id: state.projectId, status }).catch(() => {});
  scheduleSave();
  emit("meta");
}

export async function setTags(tags) {
  state.tags = tags;
  if (invoke && state.projectId) invoke("set_project_tags", { id: state.projectId, tags }).catch(() => {});
  emit("meta");
}

export async function renameProject(name) {
  state.name = name;
  if (invoke && state.projectId) invoke("rename_project", { id: state.projectId, name }).catch(() => {});
  emit("meta");
}

/* ───────────── snapshots ───────────── */

export async function snapshot(label = "manual") {
  if (!invoke || !state.projectId) return null;
  await saveNow();
  return invoke("snapshot_now", { projectId: state.projectId, label });
}

export const listSnapshots = async () =>
  invoke && state.projectId ? invoke("list_snapshots", { projectId: state.projectId }) : [];

export async function restoreSnapshot(id) {
  if (!invoke) return null;
  const board = await invoke("restore_snapshot", { snapshotId: id });
  if (board) {
    await applyBoard(board);
    emit("reload");
  }
  return board;
}
