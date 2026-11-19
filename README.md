# Framed Token Maker

A Foundry VTT v14 module. Paste, drag or pick an image on an actor sheet: it becomes the actor's portrait, and a framed token is generated from it automatically.

Works with any system. It has been checked against **D&D 5e** (ApplicationV2 sheets) and **Pathfinder 2e** (ApplicationV1 sheets).

## Features

- **Paste with Ctrl+V** an image copied from a website, Discord, an image editor or a screenshot tool.
- **Drag and drop** a file from your computer, or an image from another browser tab.
- **Browse files** with Foundry's own file picker. The chosen file stays where it is.
- **Live preview** of the final token: drag to move the image inside the frame, and use the mouse wheel or the slider to zoom.
- **Automatic token**: the portrait is clipped to the frame's opening and the frame is drawn on top. The result becomes the prototype token, and it also replaces the image of the actor's tokens already placed on scenes (configurable).
- **Any frame**: point the setting to another image with a transparent center. The opening is detected automatically, with no coordinates to configure.
- Turns off Foundry's dynamic token ring on the generated token, so the frame isn't doubled.
- File names carry a timestamp, so browsers and Foundry never show a cached old image.
- Supports The Forge storage (`forgevtt`) as well as the local `data` storage.
- Available in English and Brazilian Portuguese.

## How to use

Click the actor's portrait on its sheet. You can also use the **Portrait & Token** button in the sheet header, or right-click the actor in the Actors sidebar.

Shift+click on the portrait opens the system's default file picker.

Users need the **Upload New Files** permission (Trusted Players and above by default).

## Settings

| Setting | Default | Description |
|---|---|---|
| Token frame | the included wooden frame | Image drawn over the portrait. Its transparent center is detected automatically. |
| Upload folder | `worlds/<world>/framed-tokens` | Where portraits and tokens are saved. |
| Token format | PNG | PNG or WebP. |
| Tokens already on scenes | Linked tokens only | Linked only, all tokens of the actor, or none. |
| Open on portrait click | On (per user) | Replace the portrait click with this dialog. |

## API

```js
const api = game.modules.get("framed-token-maker").api;
api.open(actor);                                   // open the dialog
const blob = await api.makeToken(imageBlob);       // framed token as a Blob
const blob2 = await api.makeToken(imageBlob, { zoom: 1.3, x: 0, y: -20 });
```

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/Augusto-ALN/framed-token-maker/releases/latest/download/module.json
```

## License

MIT. See [LICENSE](LICENSE).
