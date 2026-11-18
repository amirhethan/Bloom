// Bloom — settings dialog (Ctrl+,).

import { settings, saveSettings, invoke, state } from "./store.js";
import { openModal, toast, errorToast } from "./overlay.js";
import { t, setLocale, getLocale } from "./i18n.js";

const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-2"];

export function openSettings() {
  const body = document.createElement("div");
  body.className = "settings";
  body.innerHTML = `
    <section class="settings-group">
      <h3>${t("settings.language")}</h3>
      <label class="field"><span>${t("settings.language")}</span>
        <select class="input" id="set-locale">
          <option value="en"${getLocale() === "en" ? " selected" : ""}>English</option>
          <option value="fa"${getLocale() === "fa" ? " selected" : ""}>فارسی</option>
        </select>
      </label>
    </section>
    <section class="settings-group">
      <h3>${t("settings.writing")}</h3>
      <label class="field"><span>${t("settings.wpm")}</span>
        <input class="input" id="set-wpm" type="number" min="60" max="400" step="10" value="${settings.wpm}" />
      </label>
      <label class="field"><span>${t("settings.snap")}</span>
        <input id="set-snap" type="checkbox" ${settings.snapDefault ? "checked" : ""} />
      </label>
      <label class="field"><span>${t("settings.scroll")}</span>
        <select class="input" id="set-scroll">
          <option value="zoom"${settings.scrollMode === "zoom" ? " selected" : ""}>${t("settings.scrollZoom")}</option>
          <option value="pan"${settings.scrollMode === "pan" ? " selected" : ""}>${t("settings.scrollPan")}</option>
        </select>
      </label>
      <label class="field"><span>${t("settings.motion")}</span>
        <input id="set-motion" type="checkbox" ${settings.reduceMotion ? "checked" : ""} />
      </label>
    </section>
    <section class="settings-group">
      <h3>${t("settings.ask")}</h3>
      <div class="field"><span>${t("settings.key")}</span>
        <div class="key-row" id="key-row"></div>
      </div>
      <label class="field"><span>${t("settings.model")}</span>
        <input class="input" id="set-model" list="model-list" value="${settings.model}" dir="ltr" />
        <datalist id="model-list">${MODELS.map((m) => `<option value="${m}"></option>`).join("")}</datalist>
      </label>
      <button class="btn btn-small" id="test-key">${t("settings.test")}</button>
    </section>
    <section class="settings-group">
      <h3>${t("settings.data")}</h3>
      <div class="field"><span>${t("settings.backups")}</span><button class="btn btn-small" id="open-backups">${t("settings.openFolder")}</button></div>
      <div class="field"><span>${t("settings.hints")}</span><button class="btn btn-small" id="reset-hints">${t("settings.showAgain")}</button></div>
      <p class="settings-note">${t("settings.database")}</p>
    </section>`;

  const modal = openModal({
    title: t("settings.title"),
    body,
    footer: `<button class="btn" data-close>${t("common.close")}</button><button class="btn btn-accent" data-save>${t("common.save")}</button>`,
  });
  const card = document.querySelector("#modal-root .modal-card");

  renderKeyRow(card.querySelector("#key-row"), card);

  // language applies immediately; the rest waits for Save
  card.querySelector("#set-locale").addEventListener("change", async (e) => {
    const next = e.target.value === "fa" ? "fa" : "en";
    setLocale(next);
    await saveSettings({ locale: next });
    modal.close();
    openSettings();
  });

  card.querySelector("[data-close]").addEventListener("click", () => modal.close());
  card.querySelector("[data-save]").addEventListener("click", async () => {
    const next = {
      wpm: Number(card.querySelector("#set-wpm").value) || 150,
      snapDefault: card.querySelector("#set-snap").checked,
      scrollMode: card.querySelector("#set-scroll").value,
      reduceMotion: card.querySelector("#set-motion").checked,
      model: card.querySelector("#set-model").value.trim() || MODELS[0],
    };
    await saveSettings(next);
    state.wpm = next.wpm;
    state.snap = next.snapDefault || state.snap;
    document.documentElement.classList.toggle("reduce-motion", next.reduceMotion);
    modal.close();
    toast({ text: t("toast.settingsSaved") });
  });

  card.querySelector("#test-key").addEventListener("click", async () => {
    try {
      const res = await invoke("ai_test");
      if (res?.ok) toast({ text: t("toast.keyWorks") });
      else errorToast(res?.error || t("toast.keyRejected"));
    } catch (err) {
      errorToast(String(err.message || err));
    }
  });

  card.querySelector("#open-backups").addEventListener("click", async () => {
    try {
      const dir = await invoke("backups_dir");
      await invoke("open_folder", { path: dir });
    } catch (err) {
      errorToast(String(err.message || err));
    }
  });

  card.querySelector("#reset-hints").addEventListener("click", async () => {
    await saveSettings({ hintsSeen: false });
    toast({ text: t("toast.hintsReset") });
  });
}

async function renderKeyRow(host, card) {
  const status = await invoke?.("ai_status").catch(() => null);
  const saved = Boolean(status?.hasKey);
  if (saved) {
    host.innerHTML = `<span class="key-saved"><svg viewBox="0 0 24 24" class="save-icon" aria-hidden="true"><path d="M5 12.5l4 4L19 7"/></svg>${t("settings.keySaved")}</span>
      <button class="btn btn-small" id="key-replace">${t("settings.replace")}</button>
      <button class="btn btn-small" id="key-remove">${t("settings.remove")}</button>`;
    host.querySelector("#key-replace").addEventListener("click", () => renderKeyInput(host, card));
    host.querySelector("#key-remove").addEventListener("click", async () => {
      await invoke("ai_clear_key");
      toast({ text: t("toast.keyRemoved") });
      renderKeyRow(host, card);
    });
    card.querySelector("#test-key").disabled = false;
    return;
  }
  await renderKeyInput(host, card);
  card.querySelector("#test-key").disabled = true;
}

function renderKeyInput(host, card) {
  host.innerHTML = `<input class="input" id="set-key" type="password" placeholder="sk-ant-…" autocomplete="off" dir="ltr" aria-label="${t("settings.key")}" />
    <button class="btn btn-small" id="save-key">${t("common.save")}</button>`;
  host.querySelector("#set-key").focus();
  host.querySelector("#save-key").addEventListener("click", async () => {
    const value = host.querySelector("#set-key").value.trim();
    if (!value) return;
    try {
      await invoke("ai_set_key", { key: value });
      host.querySelector("#set-key").value = "";
      toast({ text: t("toast.keySaved") });
      renderKeyRow(host, card);
    } catch (err) {
      errorToast(String(err.message || err));
    }
  });
}
