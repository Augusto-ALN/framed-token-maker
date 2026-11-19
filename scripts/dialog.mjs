import {
  MODULE_ID, localize as t, toUrl, slug, extensionOf,
  getFrame, drawToken, renderToken, uploadImage, fetchImage, applyToActor
} from "./token.mjs";

const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|webp|gif|avif|bmp)(\?\S*)?$/i;

/**
 * Open the portrait & token dialog for an actor.
 * Accepts an image pasted with Ctrl+V, dropped on the preview, or picked in Foundry's file browser,
 * lets the user zoom/pan it inside the frame, then saves the portrait and the framed token.
 * @param {Actor} actor
 */
export async function openTokenDialog(actor) {
  if (!actor?.isOwner) return;
  if (!game.user.can("FILES_UPLOAD")) return ui.notifications.warn(t("FTM.NoUploadPermission"));

  let frame;
  try {
    frame = await getFrame();
  } catch (err) {
    console.error(`${MODULE_ID} | could not load the frame`, err);
    return ui.notifications.error(t("FTM.FrameError"));
  }

  const state = {
    blob: null,        // pasted / dropped / fetched image
    sourcePath: null,  // image picked in the file browser (kept where it is)
    bitmap: null,
    view: { zoom: 1, x: 0, y: 0 }
  };
  let onPaste = null;

  const content = `
    <div class="ftm-dialog">
      <div class="ftm-stage" tabindex="0" data-tooltip="${t("FTM.Dialog.PanHint")}">
        <canvas class="ftm-preview" width="${frame.width}" height="${frame.height}"></canvas>
        <div class="ftm-hint">
          <i class="fa-solid fa-paste"></i>
          <strong>${t("FTM.Dialog.Paste")}</strong>
          <small>${t("FTM.Dialog.Drop")}</small>
        </div>
      </div>
      <div class="ftm-zoom">
        <i class="fa-solid fa-magnifying-glass-minus"></i>
        <input type="range" class="ftm-zoom-range" min="0.5" max="4" step="0.01" value="1" disabled
               aria-label="${t("FTM.Dialog.Zoom")}">
        <i class="fa-solid fa-magnifying-glass-plus"></i>
        <button type="button" class="ftm-reset icon fa-solid fa-arrows-rotate" disabled
                data-tooltip="${t("FTM.Dialog.Reset")}" aria-label="${t("FTM.Dialog.Reset")}"></button>
      </div>
      <button type="button" class="ftm-browse"><i class="fa-solid fa-folder-open"></i> ${t("FTM.Dialog.Browse")}</button>
      <div class="ftm-options">
        <label><input type="checkbox" class="ftm-set-portrait" checked> ${t("FTM.Dialog.SetPortrait")}</label>
        <label><input type="checkbox" class="ftm-set-token" checked> ${t("FTM.Dialog.SetToken")}</label>
      </div>
    </div>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t("FTM.Dialog.Title", { name: actor.name }), icon: "fa-solid fa-circle-user" },
    classes: ["ftm-window"],
    position: { width: 380 },
    content,
    rejectClose: false,
    buttons: [
      {
        action: "apply", label: t("FTM.Dialog.Apply"), icon: "fa-solid fa-check", default: true,
        callback: (_event, _button, dialog) => ({
          setPortrait: dialog.element.querySelector(".ftm-set-portrait").checked,
          setToken: dialog.element.querySelector(".ftm-set-token").checked
        })
      },
      { action: "cancel", label: t("FTM.Dialog.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    render: (_event, dialog) => {
      const root = dialog.element;
      const stage = root.querySelector(".ftm-stage");
      const canvas = root.querySelector(".ftm-preview");
      const ctx = canvas.getContext("2d");
      const hint = root.querySelector(".ftm-hint");
      const range = root.querySelector(".ftm-zoom-range");
      const reset = root.querySelector(".ftm-reset");
      const applyButton = root.querySelector('button[data-action="apply"]');
      applyButton.disabled = true;

      const redraw = () => drawToken(ctx, state.bitmap, frame, state.view);
      redraw();

      const resetView = () => {
        state.view = { zoom: 1, x: 0, y: 0 };
        range.value = 1;
        redraw();
      };

      const useBlob = async (blob, sourcePath = null) => {
        if (!blob?.type?.startsWith("image/")) return ui.notifications.warn(t("FTM.NotAnImage"));
        let bitmap;
        try {
          bitmap = await createImageBitmap(blob);
        } catch {
          return ui.notifications.warn(t("FTM.NotAnImage"));
        }
        state.bitmap?.close();
        Object.assign(state, { blob, sourcePath, bitmap });
        hint.hidden = true;
        range.disabled = reset.disabled = applyButton.disabled = false;
        stage.classList.add("has-image");
        resetView();
      };

      const useUrl = async (url) => {
        const blob = await fetchImage(url);
        if (blob) return useBlob(blob);
        ui.notifications.warn(t("FTM.DownloadFailed"));
      };

      // Paste: the clipboard is only readable synchronously, inside the event.
      onPaste = (event) => {
        if (event.target.closest?.("input, textarea, [contenteditable]") && !root.contains(event.target)) return;
        const data = event.clipboardData;
        const file = [...(data?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
        const html = data?.getData("text/html") ?? "";
        const text = data?.getData("text/plain")?.trim() ?? "";
        const url = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? (IMAGE_URL.test(text) ? text : null);
        if (!file && !url) return;
        event.preventDefault();
        event.stopPropagation();
        if (file) useBlob(file);
        else useUrl(url);
      };
      document.addEventListener("paste", onPaste, true);

      // Drop: files from the computer, or images dragged from another browser tab.
      stage.addEventListener("dragover", (event) => { event.preventDefault(); stage.classList.add("over"); });
      stage.addEventListener("dragleave", () => stage.classList.remove("over"));
      stage.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        stage.classList.remove("over");
        const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
        if (file) return useBlob(file);
        const html = event.dataTransfer?.getData("text/html") ?? "";
        const url = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? event.dataTransfer?.getData("text/uri-list")?.split("\n")[0]?.trim();
        if (url) useUrl(url);
      });

      // Foundry file browser: the chosen file stays where it is, only the token is generated.
      root.querySelector(".ftm-browse").addEventListener("click", () => {
        new foundry.applications.apps.FilePicker.implementation({
          type: "image",
          current: state.sourcePath ?? actor.img,
          callback: async (path) => {
            const blob = await fetchImage(toUrl(path));
            if (blob) useBlob(blob, path);
            else ui.notifications.warn(t("FTM.NotAnImage"));
          }
        }).browse();
      });

      // Zoom: slider and mouse wheel.
      range.addEventListener("input", () => { state.view.zoom = Number(range.value); redraw(); });
      reset.addEventListener("click", resetView);
      stage.addEventListener("wheel", (event) => {
        if (!state.bitmap) return;
        event.preventDefault();
        const zoom = Math.clamp(state.view.zoom * Math.exp(-event.deltaY * 0.0015), Number(range.min), Number(range.max));
        state.view.zoom = zoom;
        range.value = zoom;
        redraw();
      }, { passive: false });

      // Pan: drag the image inside the frame.
      let drag = null;
      canvas.addEventListener("pointerdown", (event) => {
        if (!state.bitmap || event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        drag = { px: event.clientX, py: event.clientY, x: state.view.x, y: state.view.y, ratio: canvas.width / canvas.clientWidth };
        stage.classList.add("dragging");
      });
      canvas.addEventListener("pointermove", (event) => {
        if (!drag) return;
        state.view.x = drag.x + (event.clientX - drag.px) * drag.ratio;
        state.view.y = drag.y + (event.clientY - drag.py) * drag.ratio;
        redraw();
      });
      const endDrag = () => { drag = null; stage.classList.remove("dragging"); };
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);

      stage.focus();
    }
  });

  if (onPaste) document.removeEventListener("paste", onPaste, true);
  if (!result || !state.bitmap || (!result.setPortrait && !result.setToken)) {
    state.bitmap?.close();
    return;
  }

  try {
    const stamp = Date.now();
    const base = slug(actor.name);
    let portraitPath = null;
    let tokenPath = null;
    if (result.setPortrait) {
      portraitPath = state.sourcePath ?? await uploadImage(state.blob, `${base}_portrait_${stamp}.${extensionOf(state.blob)}`);
    }
    if (result.setToken) {
      const token = await renderToken(state.bitmap, frame, state.view);
      tokenPath = await uploadImage(token, `${base}_token_${stamp}.${token.type === "image/webp" ? "webp" : "png"}`);
    }
    await applyToActor(actor, { portraitPath, tokenPath });
    ui.notifications.info(t("FTM.Success", { name: actor.name }));
  } catch (err) {
    console.error(`${MODULE_ID} | failed to apply the image`, err);
    ui.notifications.error(t("FTM.Failure"));
  } finally {
    state.bitmap?.close();
  }
}
