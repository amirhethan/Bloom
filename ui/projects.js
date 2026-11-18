// Bloom — projects screen: list/board views, templates, trash, import/export.

import { invoke, listProjects, settings, saveSettings, state, STATUSES } from "./store.js";
import { TEMPLATES, templateById } from "./templates.js";
import { menu, toast, errorToast, openModal } from "./overlay.js";
import { t, num } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

const ui = { view: "nodes", filter: "All", query: "", sort: "edited", projects: [] };

export async function renderProjects() {
  ui.projects = await listProjects(true).catch(() => []);
  const host = $("#project-list");
  if (!host) return;
  const visible = filterRows();
  host.className = ui.view === "board" ? "board" : ui.view === "nodes" ? "project-nodes" : "project-list";
  $$("[data-projects-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.projectsView === ui.view));
  if (ui.view === "nodes") {
    host.innerHTML = nodesView(visible);
  } else if (ui.view === "board") {
    host.innerHTML = STATUSES.map((status) => {
      const rows = visible.filter((p) => p.status === status && !p.deletedAt);
      return `<div class="board-col" data-drop-status="${status}">
        <div class="board-col-head"><span>${t(`status.${status}`)}</span><span class="board-count">${num(rows.length)}</span></div>
        ${rows.map((p) => boardCard(p)).join("") || `<div class="board-empty">${t("projects.drop")}</div>`}
      </div>`;
    }).join("");
  } else {
    host.innerHTML =
      visible
        .map(
          (p) => `<button class="project-row${p.id === state.projectId ? " is-current" : ""}${p.deletedAt ? " is-trashed" : ""}" data-project="${p.id}">
            <span class="p-name" dir="auto">${escapeHtml(p.name)}${p.archived ? ` <span class="p-flag">${t("projects.archivedFlag")}</span>` : ""}</span>
            ${p.tags ? `<span class="p-tags">${p.tags.split(",").filter(Boolean).map((tag) => `<span class="tag-chip">${escapeHtml(tag.trim())}</span>`).join("")}</span>` : "<span></span>"}
            <span class="pill-status${p.status === "Spark" ? " is-spark" : ""}">${t(`status.${p.status}`)}</span>
            <span class="meta">${p.cardCount === 1 ? t("projects.cardOne", { n: p.cardCount }) : t("projects.cards", { n: p.cardCount })} · ${t("projects.metaJoin")}${t("projects.edited", { when: ago(p.updatedAt) })}</span>
            <span class="row-more" data-more="${p.id}" role="button" aria-label="${t("menu.more")}">⋯</span>
          </button>`,
        )
        .join("") || `<p class="empty-hint">${t(ui.filter === "All" ? "projects.empty" : "projects.emptyFilter")}</p>`;
  }
}

function boardCard(p) {
  return `<button class="board-card" draggable="true" data-project="${p.id}" data-board-id="${p.id}">
    <span class="board-name" dir="auto">${escapeHtml(p.name)}</span>
    <span class="board-meta">${t("projects.cards", { n: p.cardCount })}${t("projects.metaJoin")}${ago(p.updatedAt)}</span>
  </button>`;
}

/* ── node view: every board is an idea node on the grid ── */

const NODE = { w: 264, h: 150, gapX: 32, gapY: 28, cols: 3 };
let lastNodes = [];
let nodeDrag = null;
let ignoreClickUntil = 0;

// one column on a phone, the card shrinks to the panel width
function nodeMetrics() {
  const narrow = window.matchMedia("(max-width: 720px)").matches;
  if (!narrow) return { ...NODE };
  const w = Math.min(264, Math.max(180, window.innerWidth - 56));
  return { w, h: 142, gapX: 0, gapY: 20, cols: 1 };
}

function nodePositions(rows) {
  const m = nodeMetrics();
  // a phone shows one column in order; saved desktop coordinates are not a place on a phone
  const saved = m.cols === 1 ? {} : settings.projectsNodes || {};
  return rows.map((p, i) => {
    const at = saved[p.id];
    const x = Array.isArray(at) ? at[0] : (i % m.cols) * (m.w + m.gapX);
    const y = Array.isArray(at) ? at[1] : Math.floor(i / m.cols) * (m.h + m.gapY);
    return { p, x, y, w: m.w, h: m.h };
  });
}

function nodesView(rows) {
  lastNodes = nodePositions(rows);
  if (!lastNodes.length) return `<p class="empty-hint">${t("projects.nodesEmpty")}</p>`;
  const height = Math.max(...lastNodes.map((n) => n.y)) + lastNodes[0].h + 40;
  const width = Math.max(...lastNodes.map((n) => n.x)) + lastNodes[0].w + 40;
  return `<div class="nodes-world" style="height:${height}px;width:${width}px">${lastNodes
    .map(({ p, x, y, w }) => nodeCard(p, x, y, w))
    .join("")}</div>`;
}

function nodeCard(p, x, y, w = NODE.w) {
  const meta = `${p.cardCount === 1 ? t("projects.cardOne", { n: p.cardCount }) : t("projects.cards", { n: p.cardCount })} · ${t("projects.edited", { when: ago(p.updatedAt) })}`;
  return `<div class="node-card${p.id === state.projectId ? " is-current" : ""}${p.deletedAt ? " is-trashed" : ""}"
    data-project="${p.id}" data-node="${p.id}" role="button" tabindex="0" dir="auto"
    style="width:${w}px;transform:translate(${x}px,${y}px)" aria-label="${escapeHtml(p.name)}">
    <div class="node-head">
      <span class="dot" aria-hidden="true"></span>
      <span class="node-label">${t("projects.nodeLabel")}</span>
      <span class="node-status">${t(`status.${p.status}`)}</span>
      <span class="node-more" data-more="${p.id}" role="button" tabindex="-1" aria-label="${t("menu.more")}">⋯</span>
    </div>
    <div class="node-title" dir="auto">${escapeHtml(p.name)}${p.archived ? ` <span class="p-flag">${t("projects.archivedFlag")}</span>` : ""}</div>
    <div class="node-meta">${meta}</div>
  </div>`;
}

const filterRows = () => {
  let rows = ui.projects.slice();
  if (ui.filter === "Trash") rows = rows.filter((p) => p.deletedAt);
  else if (ui.filter === "Archived") rows = rows.filter((p) => p.archived && !p.deletedAt);
  else rows = rows.filter((p) => !p.deletedAt && (ui.filter === "All" || p.status === ui.filter));
  if (ui.query.trim()) {
    const q = ui.query.toLowerCase();
    rows = rows.filter((p) => (p.name + " " + (p.tags || "")).toLowerCase().includes(q));
  }
  rows.sort((a, b) => (ui.sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt));
  return rows;
};

const ago = (ms) => {
  if (!ms) return t("projects.justNow");
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return t("projects.justNow");
  if (mins < 60) return t("projects.minAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("projects.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? "projects.dayAgo" : "projects.daysAgo", { n: days });
};

/* ───────────── actions ───────────── */

export async function openProject(id, onOpen) {
  if (!invoke) return;
  const board = await invoke("load_board", { projectId: id });
  if (!board) return errorToast(t("projects.loadFailed"));
  onOpen(board);
}

export async function deleteProject(id, onUndo) {
  if (!invoke) return;
  await invoke("delete_project", { id });
  toast({ text: t("toast.boardTrashed"), actionLabel: t("common.undo"), onAction: async () => {
    await invoke("restore_project", { id });
    renderProjects();
    onUndo?.();
  } });
  renderProjects();
}

export async function renameProject(p) {
  const body = document.createElement("div");
  body.innerHTML = `<label class="field"><span>${t("projects.name")}</span><input class="input" id="rename-input" dir="auto" value="${escapeHtml(p.name)}" /></label>
    <label class="field"><span>${t("projects.tags")}</span><input class="input" id="tags-input" dir="auto" value="${escapeHtml(p.tags || "")}" /></label>`;
  const modal = openModal({
    title: t("projects.rename"),
    body,
    footer: `<button class="btn" data-cancel>${t("common.cancel")}</button><button class="btn btn-accent" data-save>${t("common.save")}</button>`,
  });
  const card = $("#modal-root .modal-card");
  card.querySelector("[data-cancel]").addEventListener("click", () => modal.close());
  card.querySelector("[data-save]").addEventListener("click", async () => {
    const name = card.querySelector("#rename-input").value.trim() || t("app.untitled");
    const tags = card.querySelector("#tags-input").value.trim();
    await invoke("rename_project", { id: p.id, name });
    await invoke("set_project_tags", { id: p.id, tags });
    modal.close();
    renderProjects();
  });
}

export async function duplicateProject(p) {
  try {
    await invoke("duplicate_project", { id: p.id, name: `${p.name} ${t("projects.copySuffix")}` });
    toast({ text: t("toast.boardDuplicated") });
    renderProjects();
  } catch (err) {
    errorToast(String(err));
  }
}

export async function newBoard(templateId = "blank", onOpen) {
  const template = templateById(templateId);
  if (!invoke) return errorToast(t("toast.needsApp"));
  const board = template.build();
  const created = await invoke("create_project", { name: board.name, seed: board });
  await renderProjects();
  onOpen({ ...board, projectId: created.id, name: created.name, status: created.status });
  return created;
}

export async function pickTemplate() {
  const body = document.createElement("div");
  body.className = "template-grid";
  body.innerHTML = TEMPLATES.map(
    (tpl) => `<button class="template-card" data-template="${tpl.id}">
      <span class="template-name">${escapeHtml(t(`tpl.${tpl.id}`))}</span>
      <span class="template-desc">${escapeHtml(t(`tpl.${tpl.id}Desc`))}</span>
    </button>`,
  ).join("");
  const modal = openModal({ title: t("projects.newTitle"), body, wide: true });
  body.addEventListener("click", (e) => {
    const card = e.target.closest("[data-template]");
    if (!card) return;
    modal.close();
    document.dispatchEvent(new CustomEvent("bloom:new-board", { detail: card.dataset.template }));
  });
}

export async function exportBloom(p) {
  try {
    const picked = await invoke("plugin:dialog|save", {
      options: { defaultPath: `${p.name.replace(/[^\w\- ]+/g, "").trim() || "board"}.bloom`, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
    });
    if (!picked) return;
    await invoke("export_bloom", { projectId: p.id, path: picked });
    toast({ text: t("toast.exported", { name: `${p.name}.bloom` }) });
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

export async function importBloom(onOpen) {
  try {
    const picked = await invoke("plugin:dialog|open", {
      options: { multiple: false, filters: [{ name: "Bloom bundle", extensions: ["bloom"] }] },
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    const created = await invoke("import_bloom", { path });
    await renderProjects();
    toast({ text: t("toast.imported", { name: created.name }) });
    onOpen?.(created.id);
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

/* ───────────── wiring ───────────── */

export function initProjects({ onOpen, onNew }) {
  const host = $("#project-list");

  host.addEventListener("click", (e) => {
    if (Date.now() < ignoreClickUntil) return;
    const more = e.target.closest("[data-more]");
    if (more) {
      e.stopPropagation();
      const p = ui.projects.find((x) => x.id === more.dataset.more);
      if (!p) return;
      const rect = more.getBoundingClientRect();
      menu(rect.left, rect.bottom + 6, [
        { label: t("menu.open"), run: () => openProject(p.id, onOpen) },
        { label: t("menu.rename"), run: () => renameProject(p) },
        { label: t("menu.duplicate"), run: () => duplicateProject(p) },
        { label: t("menu.exportBloom"), run: () => exportBloom(p) },
        {
          label: t(p.deletedAt ? "menu.restoreTrash" : "menu.archive"),
          run: async () => {
            if (p.deletedAt) await invoke("restore_project", { id: p.id });
            else await invoke("archive_project", { id: p.id, archived: !p.archived });
            renderProjects();
          },
        },
        { separator: true },
        { label: t(p.deletedAt ? "menu.deleteForever" : "menu.trash"), run: () => (p.deletedAt ? invoke("purge_project", { id: p.id }).then(renderProjects) : deleteProject(p.id)) },
      ]);
      return;
    }
    const row = e.target.closest("[data-project]");
    if (row) openProject(row.dataset.project, onOpen);
  });

  // node view: drag a node to move it, click (no movement) to open
  host.addEventListener("pointerdown", (e) => {
    if (ui.view !== "nodes") return;
    const card = e.target.closest(".node-card");
    if (!card || e.target.closest("[data-more]")) return;
    const at = lastNodes.find((n) => n.p.id === card.dataset.node);
    if (!at) return;
    nodeDrag = { card, id: card.dataset.node, sx: e.clientX, sy: e.clientY, ox: at.x, oy: at.y, dx: 0, dy: 0, moved: false };
    card.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (!nodeDrag) return;
    const dx = e.clientX - nodeDrag.sx;
    const dy = e.clientY - nodeDrag.sy;
    if (!nodeDrag.moved && Math.hypot(dx, dy) < 4) return;
    nodeDrag.moved = true;
    nodeDrag.dx = dx;
    nodeDrag.dy = dy;
    nodeDrag.card.classList.add("is-dragging");
    nodeDrag.card.style.transform = `translate(${nodeDrag.ox + dx}px,${nodeDrag.oy + dy}px)`;
  });
  host.addEventListener("pointerup", async () => {
    if (!nodeDrag) return;
    const d = nodeDrag;
    nodeDrag = null;
    d.card.classList.remove("is-dragging");
    if (!d.moved) return;
    ignoreClickUntil = Date.now() + 300;
    const x = Math.max(0, Math.round(d.ox + d.dx));
    const y = Math.max(0, Math.round(d.oy + d.dy));
    await saveSettings({ projectsNodes: { ...(settings.projectsNodes || {}), [d.id]: [x, y] } });
    renderProjects();
  });
  host.addEventListener("keydown", (e) => {
    if (ui.view !== "nodes" || (e.key !== "Enter" && e.key !== " ")) return;
    const card = e.target.closest(".node-card");
    if (!card) return;
    e.preventDefault();
    openProject(card.dataset.node, onOpen);
  });

  host.addEventListener("dragstart", (e) => {
    const card = e.target.closest("[data-board-id]");
    if (card) e.dataTransfer.setData("text/plain", card.dataset.boardId);
  });
  host.addEventListener("dragover", (e) => {
    if (e.target.closest("[data-drop-status]")) e.preventDefault();
  });
  host.addEventListener("drop", async (e) => {
    const col = e.target.closest("[data-drop-status]");
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    await invoke("set_project_status", { id, status: col.dataset.dropStatus });
    renderProjects();
  });

  $$("[data-projects-view]").forEach((btn) =>
    btn.addEventListener("click", () => {
      ui.view = btn.dataset.projectsView;
      $$("[data-projects-view]").forEach((b) => b.classList.toggle("is-active", b === btn));
      renderProjects();
    }),
  );

  $("#project-search")?.addEventListener("input", (e) => {
    ui.query = e.target.value;
    renderProjects();
  });
  $("#project-sort")?.addEventListener("change", (e) => {
    ui.sort = e.target.value;
    renderProjects();
  });

  $$(".filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      ui.filter = btn.dataset.filter || btn.textContent.trim();
      $$(".filter").forEach((f) => f.classList.toggle("is-active", f === btn));
      renderProjects();
    }),
  );

  $("#new-board")?.addEventListener("click", () => pickTemplate());
  document.addEventListener("bloom:new-board", (e) => onNew(e.detail));
  document.addEventListener("bloom:projects-changed", () => renderProjects());
  $("#import-bloom")?.addEventListener("click", () => importBloom(onOpen));
}

export const projectState = ui;
