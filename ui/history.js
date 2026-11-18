// Bloom — history drawer (Ctrl+H): snapshots, restore, snapshot now.

import { listSnapshots, snapshot, restoreSnapshot, saveNow } from "./store.js";
import { toast, errorToast } from "./overlay.js";
import { t, num, localizeDigits } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let rows = [];

export const historyOpen = () => !$("#history-drawer").hidden;

export function initHistory({ onRestore } = {}) {
  $("#history-close").addEventListener("click", () => toggleHistory(false));
  $("#snapshot-now").addEventListener("click", async () => {
    await snapshot("manual");
    await renderHistory();
    toast({ text: t("toast.snapshot") });
  });
  $("#history-drawer").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-restore]");
    if (!btn) return;
    const id = btn.dataset.restore;
    try {
      await saveNow();
      const board = await restoreSnapshot(id);
      if (board) {
        await renderHistory();
        onRestore?.(board);
        toast({ text: t("toast.restored") });
      }
    } catch (err) {
      errorToast(String(err.message || err));
    }
  });
}

export async function renderHistory() {
  const host = $("#history-list");
  rows = await listSnapshots().catch(() => []) || [];
  host.innerHTML =
    rows
      .map(
        (s) => `<div class="history-row">
          <div class="history-main">
            <span class="history-time">${stamp(s.createdAt)}</span>
            <span class="history-label">${escapeHtml(s.label || t("history.snapshot"))}</span>
          </div>
          <div class="history-side">
            <span class="history-count">${t("history.cards", { n: s.cardCount })}</span>
            <button class="btn btn-small" data-restore="${s.id}">${t("common.restore")}</button>
          </div>
        </div>`,
      )
      .join("") || `<p class="drawer-empty">${t("history.empty")}</p>`;
}

export function toggleHistory(open = !historyOpen()) {
  const drawer = $("#history-drawer");
  drawer.hidden = !open;
  drawer.classList.toggle("is-open", open);
  if (open) renderHistory();
}

const stamp = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const loc = document.documentElement.lang === "fa" ? "fa" : undefined;
  const time = localizeDigits(d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }));
  return sameDay ? time : `${localizeDigits(d.toLocaleDateString(loc, { month: "short", day: "numeric" }))} ${time}`;
};
