export const MODULE_ID = "framed-token-maker";
export const DEFAULT_FRAME = `modules/${MODULE_ID}/assets/frame.png`;

const FilePicker = () => foundry.applications.apps.FilePicker.implementation;

const MIME_EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg"
};

export const localize = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Turn a stored path into a URL the browser can load. */
export const toUrl = (path) => (/^(https?:|data:|blob:)/i.test(path) ? path : foundry.utils.getRoute(path));

/** File-system-safe slug for an actor name. */
export const slug = (name) => String(name ?? "").slugify({ strict: true }) || "actor";

/** Extension for an image blob/file, falling back to its file name and finally to png. */
export function extensionOf(blob) {
  if (MIME_EXT[blob.type]) return MIME_EXT[blob.type];
  const fromName = blob.name?.split(".").pop()?.toLowerCase();
  return fromName && Object.values(MIME_EXT).includes(fromName) ? fromName : "png";
}

export async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  return img;
}

/* -------------------------------------------- */
/*  Frame                                       */
/* -------------------------------------------- */

const frameCache = new Map();
export const clearFrameCache = () => frameCache.clear();

/**
 * Find the transparent hole of a frame: flood-fill the transparent pixels connected to the
 * center of the image and take the bounding box of that region.
 */
function detectHole(img) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const alpha = ctx.getImageData(0, 0, width, height).data;
  const isClear = (i) => alpha[i * 4 + 3] < 128;

  const fallback = { cx: width / 2, cy: height / 2, r: Math.min(width, height) * 0.4 };
  let start = Math.floor(height / 2) * width + Math.floor(width / 2);
  if (!isClear(start)) return fallback;

  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = start;
  seen[start] = 1;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  while (top) {
    const i = stack[--top];
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
    for (const n of next) {
      if (n < 0 || seen[n] || !isClear(n)) continue;
      seen[n] = 1;
      stack[top++] = n;
    }
  }
  // Hole touches the border: the frame is not closed, so the detection is meaningless.
  if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1) return fallback;
  return {
    cx: (minX + maxX + 1) / 2,
    cy: (minY + maxY + 1) / 2,
    r: Math.min(maxX - minX + 1, maxY - minY + 1) / 2
  };
}

/** Load the configured frame (cached) and measure its hole. */
export function getFrame() {
  const path = game.settings.get(MODULE_ID, "framePath") || DEFAULT_FRAME;
  if (!frameCache.has(path)) {
    const promise = loadImage(toUrl(path)).then((img) => ({
      img, path, width: img.naturalWidth, height: img.naturalHeight, ...detectHole(img)
    }));
    promise.catch(() => frameCache.delete(path));
    frameCache.set(path, promise);
  }
  return frameCache.get(path);
}

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

/**
 * Draw the portrait clipped to the frame hole, then the frame on top.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ImageBitmap|null} portrait
 * @param {object} frame               Result of getFrame()
 * @param {{zoom:number,x:number,y:number}} view  Zoom (1 = cover the hole) and offset in frame pixels
 */
export function drawToken(ctx, portrait, frame, { zoom = 1, x = 0, y = 0 } = {}) {
  const { img, width, height, cx, cy, r } = frame;
  ctx.clearRect(0, 0, width, height);
  if (portrait) {
    const radius = r + 3; // a little past the hole; the frame hides the excess
    const scale = Math.max((2 * radius) / portrait.width, (2 * radius) / portrait.height) * zoom;
    const w = portrait.width * scale;
    const h = portrait.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(portrait, cx - w / 2 + x, cy - h / 2 + y, w, h);
    ctx.restore();
  }
  ctx.drawImage(img, 0, 0, width, height);
}

/** Render the final token image as a Blob. */
export async function renderToken(portrait, frame, view) {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  drawToken(canvas.getContext("2d"), portrait, frame, view);
  const format = game.settings.get(MODULE_ID, "tokenFormat") === "webp" ? "image/webp" : "image/png";
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))), format, 0.92);
  });
}

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

function storage() {
  const source = globalThis.ForgeVTT?.usingTheForge ? "forgevtt" : "data";
  const configured = game.settings.get(MODULE_ID, "folder")?.trim();
  const folder = (configured || `worlds/${game.world.id}/framed-tokens`).replace(/^\/+|\/+$/g, "");
  return { source, folder };
}

const ensuredFolders = new Set();

/** Create the folder (and its parents) if it does not exist yet. */
async function ensureFolder(source, folder) {
  const key = `${source}:${folder}`;
  if (ensuredFolders.has(key)) return;
  let current = "";
  for (const part of folder.split("/")) {
    current = current ? `${current}/${part}` : part;
    try {
      await FilePicker().browse(source, current);
    } catch {
      try { await FilePicker().createDirectory(source, current); } catch { /* created meanwhile */ }
    }
  }
  ensuredFolders.add(key);
}

/** Upload a blob and return its stored path. */
export async function uploadImage(blob, fileName) {
  const { source, folder } = storage();
  await ensureFolder(source, folder);
  const file = new File([blob], fileName, { type: blob.type || "image/png" });
  const response = await FilePicker().upload(source, folder, file, {}, { notify: false });
  if (!response?.path) throw new Error(response?.message || `Upload of ${fileName} failed`);
  return response.path;
}

/** Fetch an image from a URL (e.g. the src of an <img> copied from a web page). */
export async function fetchImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type.startsWith("image/") ? blob : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------- */
/*  Applying                                    */
/* -------------------------------------------- */

/**
 * Write the new portrait and/or token to the actor, its prototype token and the tokens already placed.
 * @param {Actor} actor
 * @param {{portraitPath?: string|null, tokenPath?: string|null}} paths
 */
export async function applyToActor(actor, { portraitPath = null, tokenPath = null }) {
  const tokenChanges = tokenPath ? { "texture.src": tokenPath, "ring.enabled": false } : {};

  // Actor of an unlinked token: only that token changes.
  if (actor.isToken) {
    if (portraitPath) await actor.update({ img: portraitPath });
    if (tokenPath) await actor.token.update(tokenChanges);
    return;
  }

  const update = {};
  if (portraitPath) update.img = portraitPath;
  for (const [k, v] of Object.entries(tokenChanges)) update[`prototypeToken.${k}`] = v;
  await actor.update(update);
  if (!tokenPath) return;

  const mode = game.settings.get(MODULE_ID, "placedTokens");
  if (mode === "none") return;
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter((t) => t.actorId === actor.id && (mode === "all" || t.actorLink) && t.canUserModify(game.user, "update"))
      .map((t) => ({ _id: t.id, ...tokenChanges }));
    if (!updates.length) continue;
    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not update tokens in scene ${scene.name}`, err);
    }
  }
}
