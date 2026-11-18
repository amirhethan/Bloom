// Bloom — Ask panel (Ctrl+J). Requests go through Rust; nothing is sent
// until an action is triggered.

import { state, invoke, walkScript, primaryText, makeCard, commit, nextZ, sel, cardById, uid, settings } from "./store.js";
import { toast, errorToast } from "./overlay.js";
import { insertCard, focusCard } from "./engine.js";
import { t, getLocale } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ACTIONS = [
  { id: "hooks", kind: "hook" },
  { id: "tighten", kind: "script" },
  { id: "expand", kind: "script" },
  { id: "titles", kind: "titles" },
  { id: "critique", kind: "sticky" },
  { id: "broll", kind: "shot" },
];
const actionLabel = (id) => t(`ai.actions.${id}`);
const actionDesc = (id) => t(`ai.actions.${id}Desc`);

let listening = false;
let current = null;

export const aiOpen = () => !$("#ai-drawer").hidden;

export function initAi() {
  $("#ai-actions").innerHTML = ACTIONS.map(
    (a) => `<button class="ai-row" data-action="${a.id}"><span>${escapeHtml(actionLabel(a.id))}</span><span class="ai-row-desc">${escapeHtml(actionDesc(a.id))}</span></button>`,
  ).join("");
  $("#ai-close").addEventListener("click", () => toggleAi(false));
  $("#ai-actions").addEventListener("click", (e) => {
    const row = e.target.closest("[data-action]");
    if (row) runAction(row.dataset.action);
  });
  $("#ai-send").addEventListener("click", () => {
    const prompt = $("#ai-prompt").value.trim();
    if (prompt) runPrompt(prompt);
  });
  $("#ai-preview-toggle").addEventListener("click", () => {
    const box = $("#ai-preview");
    box.hidden = !box.hidden;
    $("#ai-preview-toggle").setAttribute("aria-expanded", String(!box.hidden));
  });
  $("#ai-results").addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const block = copy.closest(".ai-result");
      await navigator.clipboard?.writeText(block.querySelector(".ai-result-text").textContent || "");
      toast({ text: t("common.copied") });
      return;
    }
    const insert = e.target.closest("[data-insert]");
    if (insert) {
      const block = insert.closest(".ai-result");
      insertResult(block);
      return;
    }
    const replace = e.target.closest("[data-replace]");
    if (replace) {
      const block = replace.closest(".ai-result");
      replaceResult(block);
      return;
    }
    const ref = e.target.closest("[data-ref]");
    if (ref) {
      const index = Number(ref.dataset.ref);
      const { blocks } = walkScript();
      const target = blocks.filter((b) => b.card.type === "script")[index];
      if (target) focusCard(target.card.id);
    }
  });
  listenStreams();
}

function listenStreams() {
  if (listening || !window.__TAURI__?.event) return;
  listening = true;
  const { listen } = window.__TAURI__.event;
  listen("ai://chunk", (e) => {
    const { requestId, text } = e.payload || {};
    if (!current || current.requestId !== requestId) return;
    current.text += text;
    current.el.querySelector(".ai-result-text").textContent = current.text;
    current.el.querySelector(".ai-result-text").scrollTop = 1e6;
  });
  listen("ai://done", (e) => {
    const { requestId } = e.payload || {};
    if (!current || current.requestId !== requestId) return;
    current.el.classList.remove("is-streaming");
    const textEl = current.el.querySelector(".ai-result-text");
    const text = textEl.textContent || "";
    if (/\[S\d+\]/.test(text)) {
      textEl.innerHTML = escapeHtml(text).replace(/\[S(\d+)\]/g, (m, n) => `<button class="ai-ref" data-ref="${n - 1}">${m}</button>`);
    }
    current.el.querySelector(".ai-result-actions").hidden = false;
    current = null;
  });
  listen("ai://error", (e) => {
    const { requestId, error } = e.payload || {};
    if (!current || current.requestId !== requestId) return;
    current.el.classList.remove("is-streaming");
    current.el.querySelector(".ai-result-text").textContent = error || t("ai.failed");
    current = null;
  });
}

export function toggleAi(open = !aiOpen()) {
  const drawer = $("#ai-drawer");
  drawer.hidden = !open;
  drawer.classList.toggle("is-open", open);
  if (open) refreshContext();
}

function selectionText() {
  return [...sel.cards]
    .map(cardById)
    .filter(Boolean)
    .map((c) => `${t(`type.${c.type}`)}: ${primaryText(c)}`)
    .join("\n");
}

export function contextPack() {
  const { blocks } = walkScript();
  const chosen = state.cards
    .filter((c) => c.type === "titles")
    .map((c) => c.items?.find((t) => t.id === c.chosen)?.text)
    .filter(Boolean);
  const script = blocks
    .map((b, i) => `${b.card.type === "hook" ? "HOOK" : `S${i}`}: ${b.card.text}`)
    .join("\n");
  const selected = selectionText();
  return {
    text: [
      `Project: ${state.name}`,
      chosen.length ? `Chosen title: ${chosen.join(" / ")}` : "",
      script ? `Script path:\n${script}` : "",
      selected ? `Selected cards:\n${selected}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    chips: [
      t("ai.selected", { n: sel.cards.size || 0 }),
      t("ai.blocks", { n: blocks.length }),
      chosen.length ? t("ai.titleChosen") : t("ai.noTitle"),
    ],
  };
}

function refreshContext() {
  const pack = contextPack();
  $("#ai-chips").innerHTML = pack.chips.map((c) => `<span class="ctx-chip">${escapeHtml(c)}</span>`).join("");
  $("#ai-preview").textContent = pack.text || t("ai.nothing");
  $("#ai-model").textContent = settings.model;
}

function runAction(action) {
  const pack = contextPack();
  const prompts = {
    hooks: `Write 5 hook variations for this video. One per line, no numbering, no commentary.\n\n${pack.text}`,
    tighten: `Tighten this text by about 25% without losing meaning. Return only the tightened text.\n\n${selectionText() || pack.text}`,
    expand: `Expand this into one more beat that keeps the promise. Return only the new text.\n\n${selectionText() || pack.text}`,
    titles: `Write 8 title candidates, one per line, no numbering, no commentary.\n\n${pack.text}`,
    critique: `Critique retention. Name the exact block where viewers are most likely to leave and why, as short lines that begin with [S1], [S2] and so on.\n\n${pack.text}`,
    broll: `Suggest 5 concrete B-roll shots for this script. One per line as "shot — why", no numbering.\n\n${pack.text}`,
  };
  send(action, prompts[action] || pack.text, ACTIONS.find((a) => a.id === action)?.kind || "sticky");
}

function runPrompt(prompt) {
  $("#ai-prompt").value = "";
  send("prompt", `${prompt}\n\n${contextPack().text}`, "sticky");
}

async function send(actionId, prompt, kind) {
  const host = $("#ai-results");
  const el = document.createElement("div");
  el.className = "ai-result is-streaming";
  el.dataset.kind = kind;
  el.dataset.action = actionId;
  el.innerHTML = `<div class="ai-result-head">${escapeHtml(actionId === "prompt" ? t("ai.answer") : actionLabel(actionId))}</div>
    <div class="ai-result-text" dir="auto" aria-live="polite"></div>
    <div class="ai-result-actions" hidden>
      <button class="btn btn-small" data-insert>${t("ai.insert")}</button>
      <button class="btn btn-small" data-replace>${t("ai.replace")}</button>
      <button class="btn btn-small" data-copy>${t("common.copy")}</button>
    </div>`;
  host.prepend(el);
  const requestId = uid("ai");
  current = { requestId, el, text: "", kind };
  try {
    const ask = getLocale() === "fa" ? `Answer in Persian (فارسی).\n\n${prompt}` : prompt;
    await invoke("ai_generate", {
      requestId,
      prompt: ask,
      context: "",
      model: settings.model,
      maxTokens: 2048,
    });
  } catch (err) {
    el.classList.remove("is-streaming");
    const message = String(err.message || err);
    el.querySelector(".ai-result-text").textContent = message;
    if (message.includes("no API key")) errorToast(t("ai.noKey"));
    current = null;
  }
}

function targetCard() {
  const id = [...sel.cards][0];
  return id ? cardById(id) : null;
}

function replaceResult(block) {
  const card = targetCard();
  if (!card) return errorToast(t("ai.selectOne"));
  const text = block.querySelector(".ai-result-text").textContent || "";
  if (card.type === "titles") {
    card.items = text.split("\n").map((t) => t.trim()).filter(Boolean).map((t) => ({ id: uid("t"), text: t }));
    card.chosen = card.items[0]?.id || null;
  } else {
    card[card.type === "idea" ? "title" : card.type === "thumbnail" ? "overlay" : card.type === "image" ? "caption" : "text"] = text;
  }
  commit("ai-replace");
  toast({ text: t("ai.replaced") });
}

function insertResult(block) {
  const text = block.querySelector(".ai-result-text").textContent || "";
  const lines = text.split("\n").map((l) => l.replace(/^\s*[-*\d.\[\]S]+\s*/, "").trim()).filter(Boolean);
  const anchor = targetCard() || walkScript().blocks[walkScript().blocks.length - 1]?.card;
  const baseX = anchor ? anchor.x + anchor.w + 60 : 620;
  const baseY = anchor ? anchor.y : 160;
  const kind = block.dataset.kind || "sticky";
  let created = 0;

  const add = (type, payload, index) => {
    const card = makeCard(type, baseX, baseY + index * 120, { ...payload, z: nextZ() });
    state.cards.push(card);
    if (anchor) {
      state.vines.push({ id: uid("v"), from: anchor.id, fromPin: "right", to: card.id, toPin: "left", kind: "vine" });
    }
    created++;
    return card;
  };

  if (kind === "titles") {
    add("titles", {
      items: lines.slice(0, 8).map((t) => ({ id: uid("t"), text: t })),
      chosen: null,
    }, 0).chosen = null;
    const card = state.cards[state.cards.length - 1];
    card.chosen = card.items[0]?.id || null;
  } else if (kind === "hook") {
    lines.slice(0, 5).forEach((line, i) => add("hook", { text: line, style: "bold claim", w: 300 }, i));
  } else if (kind === "shot") {
    lines.slice(0, 6).forEach((line, i) => add("shot", { text: line, status: "needed", tag: "B-roll", w: 240 }, i));
  } else if (kind === "script") {
    add("script", { text: text.trim(), section: t("script.sectionName"), w: 300 }, 0);
  } else {
    lines.slice(0, 4).forEach((line, i) => add("sticky", { text: line, rotation: -2, w: 200 }, i));
  }
  commit("ai-insert");
  toast({ text: t(created === 1 ? "toast.cardAdded" : "toast.cardsAdded", { n: created }) });
}
