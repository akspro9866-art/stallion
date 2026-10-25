<img src="./images/icon.png" alt="Stallion icon" align="left" width="86" style="margin-right: -15px;" />

# stallion

<br/>

VSCode extension to send scripts to [Cavalry](https://cavalry.scenegroup.co/).

> **Fork notice** — this is a fork of [scenery-io/stallion](https://github.com/scenery-io/stallion)
> (v0.8.0) extended for automation clients such as MCP servers. The additions are
> additive and backwards compatible: the original POST protocol still works, and
> `seq` is optional. See [Bridge protocol](#bridge-protocol-v09) below.

## Features

-   Send scripts and Render scripts to Cavalry
-   Apply expressions to JavaScript- and SkSL layers
-   Insert Cavalry's Typescript definitions
-   Installs the Stallion script automatically
-   Functions as an API for other tools
-   **(fork)** Results and errors served on `GET /get`, status heartbeat, configurable host/port, optional token auth

## Requirements

-   [VSCode](https://code.visualstudio.com/)
-   [Cavalry](https://cavalry.scenegroup.co/) 1.5.2+

## Installation

Install [Stallion from the marketplace](https://marketplace.visualstudio.com/items?itemName=Scenery.cavalry-bridge) or look for "Stallion" in the VSCode extension tab and click the `install` button.

## Usage

To send scripts to Cavalry the Stallion script needs to be open in Cavalry. After the extension is installed, the Stallion script should be available in Cavalry via `Scripts > Stallion`.

The VSCode extension exposes the following commands to the Command Palette (`View > Command Palette`).

1.  ### Send To Cavalry

    This will send the text from the active editor to Cavalry as a script. It doesn't have to be a saved file. Focus the Cavalry window and check the Log Window for any errors.

    If it was sucessful the Log Window will show:

    ```bash
    [Info]
    JavaScript: Stallion: Script successfully executed
    ```

1.  ### Send To Cavalry As…

    This will send the text from the active editor as an expression to Cavalry. It will apply the expression to the selected layers of the chosen type. If there is no selection it will create a layer of the chosen type.

    Render Scripts will be applied to all render queue items that are enabled, ie. the checkmark is visible. The Render Manager does not have to be open to apply Render Scripts.

    Choose to send it as:

    -   JavaScript Shape
    -   JavaScript Utility
    -   JavaScript Modifier
    -   JavaScript Deformer
    -   JavaScript Emitter
    -   SkSL Shader
    -   SkSL Filter
    -   Setup Script
    -   Pre-Render Script
    -   Post-Render Script

1.  ### Insert Cavalry Types

    This will enable auto-complete for Cavalry's scripting API. It inserts a comment at the top of the open editor which references the latest [cavalry-types](https://github.com/scenery-io/cavalry-types).

    Cavalry has various [scripting namespaces](https://cavalry.studio/docs/tech-info/scripting/scripting-getting-started/#modules) that can be used in specific contexts eg. JavaScript Layers, Render Scripts, etc.

    Select one of the following contexts and it will expose only those types that are available in that context. The available contexts are:

    - `script` for Scripts with or without UI
    - `plugin` for Scripts that are part of a Plugin
    - `shape` for JavaScript Shapes
    - `deformer` for JavaScript Deformers
    - `utility` for JavaScript Utilities
    - `emitter` for JavaScript Particle Emitters
    - `modifier` for JavaScript Particle Modifiers
    - `render` for Setup, Pre- and Post-Render Scripts

## Known Issues

-   `ui.scriptLocation` returns a temporary path if the document in VSCode hasn't been saved.
-   The server address and port default to `127.0.0.1:8080` but can now be overridden in `stallion.json` (see below).
-   Saving or opening a scene resets Cavalry's script contexts, which stops Stallion — re-run `Scripts > Stallion` afterwards (a Cavalry-level limitation).

## Configuration (optional)

Create `<Cavalry app data>/stallion.json` (the folder returned by `api.getAppDataFolder()` — on Windows `%APPDATA%\Cavalry`, on macOS `~/Library/Application Support/Cavalry`):

```json
{
	"host": "127.0.0.1",
	"port": 8080,
	"token": ""
}
```

All keys are optional. A non-empty `token` enables token authentication for both `/post` and `/get` (`Authorization: Bearer <token>` header).

## Sending data to Stallion

While Stallion is open, send a `POST` request to `http://127.0.0.1:8080/post` with the following JSON

```json
{
	"type": "",
	"code": "",
	"path": "",
	"seq": ""
}
```

### `type`

String. The type of code that's sent. Typically one of the following:

-   `script`
-   `javaScriptShape`
-   `javaScript` (Utility)
-   `javaScriptModifier`
-   `javaScriptDeformer`
-   `javaScriptEmitter`
-   `skslShader`
-   `skslFilter`
-   `renderSetupExpression`
-   `preRenderExpression`
-   `postRenderExpression`

### `code`

String. Required when `type` is a JavaScript layer, SkSL layer or a Render script.

The expression that should be applied to a layer—or the code that should be executed when `type` is `script`.

> [!IMPORTANT]
> Sending UI scripts through `code` will result in the UI being appended to the Stallion UI. Use [`path`](#path) instead.

### `path`

String. Required when sending UI scripts.

The absolute path to a script. Mainly used for UI scripts so they're opened in their own window.

### `seq`

String or number. Optional.

Echoed back in the result served on `GET /get` so callers can match a result to the request that produced it. Omit it for fire-and-forget execution (the VSCode extension does).

## Bridge protocol (v0.9)

`GET /get` always returns `text/plain` containing the latest JSON payload:

```jsonc
// Before any script has run — a heartbeat. Refreshed whenever the bridge is idle.
{ "kind": "status", "stallion": "0.9.0", "cavalry": "2.8.0", "scene": "/path/to/scene.cv", "frame": 0, "unSaved": false, "ts": 1760000000000 }

// After a script with seq "abc123" ran and returned 42
{ "type": "__stallion_result__", "kind": "result", "seq": "abc123", "ok": true, "result": 42 }

// After a script threw
{ "type": "__stallion_result__", "kind": "result", "seq": "abc123", "ok": false, "error": "boom" }

// After an expression-type post — per-layer outcome lists
{ "kind": "result", "seq": "abc123", "ok": true, "applied": ["basicShape#1"], "skipped": ["Title"] }
```

Recommended client flow:

1. `POST /post` with `{ "type": "script", "code": "…", "seq": "<uuid>" }`.
2. Poll `GET /get` until the body parses as JSON with your `seq` (or a short timeout).
3. Read `ok`, `result` / `error`.

A result stays served until the next `POST` arrives — check `ts`/`seq` before trusting a cached body. Note that expression/render posts serve their outcome with the same mechanism.

Results are captured by wrapping the posted code; the wrapper reports back through a `globalThis` stash (shared script contexts) and a loopback `api.WebClient` POST (isolated contexts), so the channel works on either engine behaviour. Scripts that post with `type` `"__stallion_result__"` are reserved for this internal channel.

## Sponsors

Huge thanks to Cavalry for sponsoring this project! Interested in sponsoring? Send us [a message](https://scenery.io/support).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./images/cavalry-white.png">
  <img alt="Cavalry" src="./images/cavalry-black.png" width="300">
</picture>

#### Icon Credits

The icon is [Horse](https://thenounproject.com/icon/horse-2128337/) by Buztas Linggar from [Noun Project](https://thenounproject.com/)
