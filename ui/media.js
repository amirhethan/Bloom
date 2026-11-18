// Bloom — image ingestion: downscale in the webview, store bytes in Rust.

import { state, invoke, makeCard, cardById, commit, nextZ } from "./store.js";
import { insertCard, selectOnly } from "./engine.js";
import { toast, errorToast } from "./overlay.js";

const MAX_EDGE = 2048;
const MAX_BYTES = 40 * 1024 * 1024;

async function downscale(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const type = blob.type === "image/png" ? "image/png" : "image/jpeg";
  const out = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
  return { blob: out || blob, width, height };
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function saveImage(blob, name = "image.png") {
  if (!invoke || !state.projectId) throw new Error("images need the desktop app");
  if (blob.size > MAX_BYTES) throw new Error("that image is larger than 40 MB");
  const { blob: small, width, height } = await downscale(blob);
  const bytes = await blobBytes(small);
  const saved = await invoke("save_attachment", {
    projectId: state.projectId,
    name,
    mime: small.type || "image/png",
    width,
    height,
    bytes: Array.from(bytes),
  });
  return { src: saved.src, width: saved.width, height: saved.height, bytes: saved.bytes };
}

export async function ingestFiles(files, world) {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) {
    toast({ text: "Only images can be dropped on the board.", tone: "error" });
    return 0;
  }
  let placed = 0;
  for (const file of list) {
    try {
      const image = await saveImage(file, file.name);
      const card = makeCard("image", world.x + placed * 24, world.y + placed * 24, {
        w: Math.min(420, image.width),
        h: Math.round(Math.min(420, image.width) * (image.height / image.width)),
        image,
        caption: "",
        z: nextZ(),
      });
      state.cards.push(card);
      selectOnly(card.id);
      placed++;
    } catch (err) {
      errorToast(String(err.message || err));
    }
  }
  if (placed) commit("image");
  return placed;
}

export async function setCardImage(card, blob, name = "image.png") {
  try {
    const image = await saveImage(blob, name);
    card.image = image;
    if (card.type === "image") {
      card.w = Math.min(card.w || 360, 420);
      card.h = Math.round(card.w * (image.height / image.width));
    }
    commit("image");
    return true;
  } catch (err) {
    errorToast(String(err.message || err));
    return false;
  }
}

export async function pickImage(world) {
  if (!window.__TAURI__) {
    toast({ text: "Image picking needs the desktop app.", tone: "error" });
    return;
  }
  try {
    const picked = await window.__TAURI__.core.invoke("plugin:dialog|open", {
      options: { multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }] },
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    const bytes = new Uint8Array(await window.__TAURI__.core.invoke("read_image_file", { path }));
    const name = String(path).split(/[\\/]/).pop();
    const blob = new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], { type: mimeFor(name) });
    const image = await saveImage(blob, name);
    const card = makeCard("image", world.x, world.y, {
      w: Math.min(420, image.width),
      h: Math.round(Math.min(420, image.width) * (image.height / image.width)),
      image,
      caption: "",
      z: nextZ(),
    });
    state.cards.push(card);
    selectOnly(card.id);
    commit("image");
  } catch (err) {
    errorToast(String(err.message || err));
  }
}

const mimeFor = (name) => {
  const ext = name.split(".").pop()?.toLowerCase();
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" }[ext] || "image/png";
};

export function blobFromClipboard(event) {
  const items = event.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

export { insertCard, cardById };
