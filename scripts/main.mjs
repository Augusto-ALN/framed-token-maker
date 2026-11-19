import { MODULE_ID, DEFAULT_FRAME, localize as t, clearFrameCache, getFrame, renderToken } from "./token.mjs";
import { openTokenDialog } from "./dialog.mjs";

const ICON = "fa-solid fa-circle-user";
const canUse = (actor) => !!actor?.isOwner && game.user.can("FILES_UPLOAD");

/* -------------------------------------------- */
/*  Settings & API                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "framePath", {
    name: "FTM.Settings.Frame.Name",
    hint: "FTM.Settings.Frame.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_FRAME,
    filePicker: "image",
    onChange: clearFrameCache
  });

  game.settings.register(MODULE_ID, "folder", {
    name: "FTM.Settings.Folder.Name",
    hint: "FTM.Settings.Folder.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "tokenFormat", {
    name: "FTM.Settings.Format.Name",
    hint: "FTM.Settings.Format.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: { png: "PNG", webp: "WebP" },
    default: "png"
  });

  game.settings.register(MODULE_ID, "placedTokens", {
    name: "FTM.Settings.Placed.Name",
    hint: "FTM.Settings.Placed.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      linked: "FTM.Settings.Placed.Linked",
      all: "FTM.Settings.Placed.All",
      none: "FTM.Settings.Placed.None"
    },
    default: "linked"
  });

  game.settings.register(MODULE_ID, "portraitClick", {
    name: "FTM.Settings.Click.Name",
    hint: "FTM.Settings.Click.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.modules.get(MODULE_ID).api = {
    /** Open the dialog for an actor. */
    open: openTokenDialog,
    /** Render a framed token Blob from any image Blob, with the configured frame. */
    async makeToken(blob, view) {
      const bitmap = await createImageBitmap(blob);
      try { return await renderToken(bitmap, await getFrame(), view); } finally { bitmap.close(); }
    }
  };
});

/* -------------------------------------------- */
/*  Portrait click on actor sheets              */
/* -------------------------------------------- */

/**
 * Replace the sheet's native "pick an image" click on the portrait with our dialog.
 * Shift+click keeps the system's original behavior. Works for ApplicationV1 sheets
 * (pf2e, most systems) and ApplicationV2 sheets (dnd5e, core).
 */
function bindPortrait(app, html) {
  const actor = app.actor ?? app.document;
  if (!(actor instanceof Actor) || !canUse(actor)) return;
  if (!game.settings.get(MODULE_ID, "portraitClick")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const el of root.querySelectorAll('img[data-edit="img"], video[data-edit="img"]')) {
    if (el.dataset.ftmBound) continue;
    el.dataset.ftmBound = "true";
    el.classList.add("ftm-portrait");
    el.addEventListener("click", (event) => {
      if (event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openTokenDialog(actor);
    }, { capture: true });
  }
}

Hooks.on("renderActorSheet", bindPortrait);      // ApplicationV1 (pf2e and others)
Hooks.on("renderActorSheetV2", bindPortrait);    // ApplicationV2 (dnd5e and others)

/* -------------------------------------------- */
/*  Header buttons                              */
/* -------------------------------------------- */

Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  if (!canUse(app.actor)) return;
  buttons.unshift({
    label: t("FTM.Button"),
    class: "ftm-header",
    icon: ICON,
    onclick: () => openTokenDialog(app.actor)
  });
});

Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  if (!canUse(app.document)) return;
  controls.push({
    action: "ftmOpen",
    label: "FTM.Button",
    icon: ICON,
    onClick: () => openTokenDialog(app.document)
  });
});

/* -------------------------------------------- */
/*  Actors sidebar context menu                 */
/* -------------------------------------------- */

Hooks.on("getActorContextOptions", (directory, options) => {
  const actorOf = (li) => game.actors.get(li.closest("[data-entry-id]")?.dataset.entryId);
  options.push({
    label: "FTM.Button",
    icon: ICON,
    visible: (li) => canUse(actorOf(li)),
    onClick: (_event, li) => openTokenDialog(actorOf(li))
  });
});
