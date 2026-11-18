// Bloom — script view: editing, path logic, export, teleprompter.

import {
  state, walkScript, scriptTotals, words, secondsFor, clock, commit, settings, saveSettings,
  cardById, invoke, uid, primaryText,
} from "./store.js";
import { cardRect, focusCard, applyTransform } from "./engine.js";
import { toast, errorToast, openModal, closeModal } from "./overlay.js";
import { t, localizeDigits } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

let rowsDirty = true;

export function markScriptDirty() {
  rowsDirty = true;
}

function sectionLabel(index) {
  return t("script.section", { n: index });
}

const wordMeta = (n) => t("script.words", { n, s: secondsFor(n) });

export function renderScript() {
  const { blocks, warnings, offPath } = walkScript();
  const totals = scriptTotals();
  $("#script-title").textContent = state.name;
  $("#script-stats").textContent = t(totals.blocks === 1 ? "script.statsOne" : "script.stats", {
    blocks: totals.blocks,
    words: totals.words,
    time: localizeDigits(clock(totals.seconds)),
    wpm: state.wpm,
  });
  const warn = $("#script-warning");
  warn.textContent = warnings.join(" ");
  warn.hidden = !warnings.length;

  const focusInside = $("#script-rows").contains(document.activeElement);
  if (focusInside && !rowsDirty) return;
  rowsDirty = false;

  let section = 0;
  const rows = blocks.map(({ card, attached }) => {
    const isHook = card.type === "hook";
    if (!isHook) section++;
    const label = isHook ? t("script.hook") : sectionLabel(section);
    const n = words(card.text);
    const minis = attached
      .map((a) => miniCard(a))
      .join("");
    return `<div class="script-row ${isHook ? "is-hook" : "is-section"}" data-block="${card.id}">
      <div class="script-cell">
        <div class="row-label">${label}<span class="row-meta">${wordMeta(n)}</span></div>
        <div class="row-text" contenteditable="true" dir="auto" data-block-field="text" data-card="${card.id}" spellcheck="false">${escapeHtml(card.text)}</div>
      </div>
      <div class="margin-col">${minis}</div>
    </div>`;
  });

  const off = offPath.length
    ? `<div class="offpath">
        <div class="offpath-head">${t("script.offPath", { n: offPath.length })}</div>
        ${offPath
          .map(
            (c) => `<div class="offpath-row">
              <span class="offpath-text" dir="auto">${escapeHtml((c.section || t("script.section", { n: 1 })) + " — " + (c.text || "").slice(0, 60))}</span>
              <button class="btn btn-small" data-add-path="${c.id}">${t("script.addToPath")}</button>
            </div>`,
          )
          .join("")}
      </div>`
    : "";

  $("#script-rows").innerHTML = rows.join("") + off;
}

function miniCard(card) {
  const cls = card.type === "sticky" ? " is-sticky" : card.type === "shot" ? " card-shot" : card.type === "hook" ? " card-hook" : " card-idea";
  if (card.type === "hook") {
    return `<div class="mini${cls}">
      <div class="mini-label">HOOK</div>
      <div class="mini-text">${escapeHtml(card.text)}</div>
      <button class="mini-chip" data-hook-style="${card.id}">${escapeHtml(card.style)}</button>
    </div>`;
  }
  if (card.type === "shot") {
    return `<div class="mini${cls}">
      <div class="mini-label">SHOT</div>
      <div class="mini-text">${escapeHtml(card.text)}</div>
      <button class="mini-chip" data-shot-status="${card.id}">${escapeHtml(card.status)}</button>
    </div>`;
  }
  const text =
    card.type === "idea" ? card.title : card.type === "titles" ? card.items?.find((t) => t.id === card.chosen)?.text : card.type === "source" ? card.title || card.url : card.text;
  return `<div class="mini${cls}">
    <div class="mini-label">${t(`type.${card.type}`)}</div>
    <div class="mini-text">${escapeHtml(text || "")}</div>
  </div>`;
}

/* ───────────── editing ───────────── */

export function initScript() {
  const host = $("#script-rows");

  host.addEventListener("input", (e) => {
    const id = e.target.dataset.card;
    if (!id) return;
    const card = cardById(id);
    if (!card) return;
    card.text = e.target.textContent;
    commit("edit", { coalesce: true });
    const { blocks } = walkScript();
    const totals = scriptTotals();
    $("#script-stats").textContent = t(totals.blocks === 1 ? "script.statsOne" : "script.stats", {
      blocks: totals.blocks,
      words: totals.words,
      time: localizeDigits(clock(totals.seconds)),
      wpm: state.wpm,
    });
    const row = e.target.closest(".script-row");
    const meta = row?.querySelector(".row-meta");
    if (meta) meta.textContent = wordMeta(words(card.text));
  });

  host.addEventListener("keydown", (e) => {
    const id = e.target.dataset.card;
    if (!id) return;
    const card = cardById(id);
    if (!card) return;

    if (e.key === "Enter" && !e.shiftKey) {
      const selection = window.getSelection();
      const atEnd = selection?.rangeCount ? isCaretAtEnd(e.target) : false;
      if (!atEnd) return;
      e.preventDefault();
      createBlockAfter(card);
      return;
    }
    if (e.key === "Backspace" && !card.text.trim()) {
      e.preventDefault();
      removeBlock(card);
    }
  });

  host.addEventListener("paste", (e) => {
    const host2 = e.target.closest("[contenteditable]");
    if (!host2) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    sel.deleteFromDocument();
    sel.getRangeAt(0).insertNode(document.createTextNode(text));
    sel.collapseToEnd();
    host2.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });

  host.addEventListener("click", (e) => {
    const addPath = e.target.closest("[data-add-path]");
    if (addPath) {
      appendToPath(addPath.dataset.addPath);
      return;
    }
    const style = e.target.closest("[data-hook-style]");
    if (style) {
      const card = cardById(style.dataset.hookStyle);
      const styles = ["question", "bold claim", "story", "pattern interrupt"];
      card.style = styles[(styles.indexOf(card.style) + 1) % styles.length];
      commit("style");
      renderScript();
      return;
    }
    const status = e.target.closest("[data-shot-status]");
    if (status) {
      const card = cardById(status.dataset.shotStatus);
      const order = ["needed", "shot", "have"];
      card.status = order[(order.indexOf(card.status) + 1) % order.length];
      commit("status");
      renderScript();
      return;
    }
    const row = e.target.closest("[data-block]");
    if (row && !e.target.closest("[contenteditable]")) {
      focusCard(row.dataset.block, false);
    }
  });
}

function isCaretAtEnd(node) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(node);
  range.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length === 0;
}

export function createBlockAfter(card) {
  const rect = cardRect(card.id);
  const frame = state.frames.find(
    (f) => card.x > f.x && card.x < f.x + f.w && card.y > f.y && card.y < f.y + f.h,
  );
  const x = frame ? card.x : card.x;
  const y = rect ? card.y + rect.h + 40 : card.y + 240;
  const next = {
    id: uid("sc"),
    type: "script",
    section: t("script.sectionName"),
    text: "",
    x,
    y,
    w: card.w || 300,
    z: state.cards.reduce((m, c) => Math.max(m, c.z || 0), 0) + 1,
  };
  const outgoing = state.vines.filter((v) => v.kind === "script" && v.from === card.id);
  state.cards.push(next);
  for (const vine of outgoing) vine.from = next.id;
  state.vines.push({ id: uid("v"), from: card.id, fromPin: "bottom", to: next.id, toPin: "top", kind: "script" });

  commit("script-block");
  renderScript();
  const el = document.querySelector(`[data-card="${next.id}"]`);
  if (el && !el.classList.contains("hidden")) {
    const editable = document.querySelector(`#script-rows [data-card="${next.id}"]`);
    editable?.focus();
  }
  toast({ text: t("toast.newBlock"), timeout: 2500 });
  return next;
}

export function removeBlock(card) {
  const incoming = state.vines.filter((v) => v.kind === "script" && v.to === card.id);
  const outgoing = state.vines.filter((v) => v.kind === "script" && v.from === card.id);
  state.vines = state.vines.filter((v) => !incoming.includes(v) && !outgoing.includes(v) && v.from !== card.id && v.to !== card.id);
  for (const inV of incoming) {
    for (const outV of outgoing) {
      state.vines.push({ id: uid("v"), from: inV.from, fromPin: inV.fromPin || "bottom", to: outV.to, toPin: outV.toPin || "top", kind: "script" });
    }
  }
  state.cards = state.cards.filter((c) => c.id !== card.id);
  commit("delete");
  renderScript();
}

export function appendToPath(cardId) {
  const { blocks } = walkScript();
  const last = blocks[blocks.length - 1]?.card;
  if (!last || last.id === cardId) return;
  state.vines.push({ id: uid("v"), from: last.id, fromPin: "bottom", to: cardId, toPin: "top", kind: "script", label: "" });
  commit("connect");
  renderScript();
}

/* ───────────── export ───────────── */

export function scriptMarkdown() {
  const { blocks } = walkScript();
  const titles = state.cards.filter((c) => c.type === "titles");
  const lines = [`# ${state.name}`, ""];
  for (const { card } of blocks) {
    if (card.type === "hook") {
      lines.push(`> ${card.text}`, "");
      continue;
    }
    const index = blocks.filter((b) => b.card.type === "script").findIndex((b) => b.card.id === card.id) + 1;
    lines.push(`## ${sectionLabel(index)}`, "", card.text, "");
    for (const vine of state.vines.filter((v) => v.from === card.id && v.kind !== "script")) {
      const other = cardById(vine.to);
      if (other?.type === "shot") lines.push(`> ${t("export.shot")}: ${other.text}`, "");
    }
  }
  for (const card of titles) {
    lines.push(`## ${t("type.titles")}`, "");
    for (const item of card.items || []) lines.push(`- ${item.text}${item.id === card.chosen ? `  ← ${t("export.chosen")}` : ""}`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function scriptPlain() {
  const { blocks } = walkScript();
  return blocks
    .map(({ card }) => (card.type === "hook" ? `[${t("script.hook")}]\n${card.text}` : `${card.section || t("script.sectionName")}\n${card.text}`))
    .join("\n\n")
    .trim() + "\n";
}

export async function exportScript(kind = "md") {
  const content = kind === "txt" ? scriptPlain() : scriptMarkdown();
  if (kind === "copy" || !invoke) {
    try {
      await navigator.clipboard.writeText(content);
      toast({ text: t("toast.clipboard") });
    } catch (err) {
      errorToast(t("toast.clipboardBlocked"));
    }
    return;
  }
  const safe = (state.name || "script").replace(/[^\w\- ]+/g, "").trim() || "script";
  try {
    const picked = await invoke("plugin:dialog|save", {
      options: { defaultPath: `${safe}.${kind}`, filters: [{ name: kind === "txt" ? t("export.text") : "Markdown", extensions: [kind] }] },
    });
    if (!picked) return;
    await invoke("write_text_file", { path: picked, contents: content });
    toast({ text: t("toast.exported", { name: String(picked).split(/[\\/]/).pop() }) });
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

/* ───────────── teleprompter ───────────── */

let tp = null;

export function openTeleprompter() {
  if (tp) return;
  const content = walkScript()
    .blocks.map(({ card }) => (card.type === "hook" ? card.text : `${card.section || t("script.sectionName")}. ${card.text}`))
    .join("\n\n");
  const el = document.createElement("div");
  el.className = "prompter";
  el.innerHTML = `<div class="prompter-bar">
      <button class="btn btn-small" data-tp="smaller" aria-label="${t("tp.smaller")}">A−</button>
      <button class="btn btn-small" data-tp="bigger" aria-label="${t("tp.bigger")}">A+</button>
      <button class="btn btn-small" data-tp="play">${t("tp.play")}</button>
      <label class="prompter-speed">${t("tp.speed")} <input type="range" min="1" max="10" step="1" data-tp="speed" value="${settings.tpSpeed}" /></label>
      <button class="btn btn-small" data-tp="mirror">${t("tp.mirror")}</button>
      <button class="btn btn-small" data-tp="close">${t("tp.exit")}</button>
    </div>
    <div class="prompter-stage"><div class="prompter-text"></div></div>
    <div class="prompter-line"></div>`;
  document.body.appendChild(el);
  const textEl = el.querySelector(".prompter-text");
  textEl.textContent = content;
  textEl.style.fontSize = `${settings.tpSize}px`;
  el.classList.toggle("is-mirrored", settings.tpMirror);
  const stage = el.querySelector(".prompter-stage");
  requestAnimationFrame(() => {
    stage.scrollTop = 0;
  });

  let playing = false;
  let speed = settings.tpSpeed;
  let last = performance.now();
  let raf = 0;

  const tick = (now) => {
    if (!playing) return;
    const dt = (now - last) / 1000;
    last = now;
    stage.scrollTop += dt * (speed * 14);
    raf = requestAnimationFrame(tick);
  };

  const setPlaying = (next) => {
    playing = next;
    el.querySelector('[data-tp="play"]').textContent = t(playing ? "tp.pause" : "tp.play");
    if (playing) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
    }
  };

  const close = () => {
    cancelAnimationFrame(raf);
    el.remove();
    tp = null;
    document.removeEventListener("keydown", onKey, true);
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === " ") {
      e.preventDefault();
      setPlaying(!playing);
    }
    if (e.key === "ArrowUp") {
      speed = Math.min(10, speed + 1);
      el.querySelector('[data-tp="speed"]').value = String(speed);
    }
    if (e.key === "ArrowDown") {
      speed = Math.max(1, speed - 1);
      el.querySelector('[data-tp="speed"]').value = String(speed);
    }
    if (e.key.toLowerCase() === "m") {
      settings.tpMirror = !settings.tpMirror;
      el.classList.toggle("is-mirrored", settings.tpMirror);
      saveSettings({ tpMirror: settings.tpMirror });
    }
  };

  el.addEventListener("click", (e) => {
    const act = e.target.closest("[data-tp]")?.dataset.tp;
    if (!act) return;
    if (act === "bigger" || act === "smaller") {
      settings.tpSize = Math.min(96, Math.max(32, settings.tpSize + (act === "bigger" ? 4 : -4)));
      textEl.style.fontSize = `${settings.tpSize}px`;
      saveSettings({ tpSize: settings.tpSize });
    }
    if (act === "play") setPlaying(!playing);
    if (act === "mirror") {
      settings.tpMirror = !settings.tpMirror;
      el.classList.toggle("is-mirrored", settings.tpMirror);
      saveSettings({ tpMirror: settings.tpMirror });
    }
    if (act === "close") close();
  });
  el.querySelector('[data-tp="speed"]').addEventListener("input", (e) => {
    speed = Number(e.target.value);
    saveSettings({ tpSpeed: speed });
  });
  document.addEventListener("keydown", onKey, true);
  tp = { close };
  return tp;
}
