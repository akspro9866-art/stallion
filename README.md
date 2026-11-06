<img src="./images/icon.png" alt="Stallion icon" align="left" width="86" style="margin-right: -15px;" />

# Stallion

<br/>

![CI](https://github.com/akspro9866-art/stallion/actions/workflows/ci.yml/badge.svg)

**A scripting bridge for [Cavalry](https://cavalry.scenegroup.co/): drive a live scene over HTTP,
capture what changed, and verify rendered frames — from VS Code, an MCP server, or CI.**

Stallion is two pieces that share one wire contract:

- a Cavalry script (`Stallion.js`) that starts an HTTP server inside the running Cavalry process, and
- a VS Code extension that installs and launches that script and sends editor contents to it.

On top of the original fire-and-forget bridge, this fork adds a result channel, deterministic
execution receipts, scene readback, frame snapshots, batch frame rendering, optional token auth and
a headless mock bridge that speaks the same protocol without Cavalry.

> **Fork notice** — this repository is a fork of
> [scenery-io/stallion](https://github.com/scenery-io/stallion), based on upstream 0.8.0 and grown
> into the 0.10.0 bridge documented here. The additions are additive and backwards compatible: the
> original `POST /post` payload still works, `seq` remains optional, and legacy file-based clients
> are untouched. See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Contents

- [How it fits](#how-it-fits)
- [Requirements](#requirements)
- [Build and install](#build-and-install)
- [Use from VS Code](#use-from-vs-code)
- [Configuration](#configuration)
- [Bridge protocol (v0.10)](#bridge-protocol-v010)
- [Execution receipts and state snapshots](#execution-receipts-and-state-snapshots)
- [Scene readback](#scene-readback)
- [Frame capture](#frame-capture)
- [Headless mock bridge](#headless-mock-bridge)
- [Safety and atomicity](#safety-and-atomicity)
- [Development](#development)
- [Limitations](#limitations)
- [Compatibility and versioning](#compatibility-and-versioning)
- [Credits and license](#credits-and-license)

---

## How it fits

```
automation client                     Stallion inside Cavalry                 scene
─────────────────                     ───────────────────────                 ─────
cavalry-mcp / refclone / curl
        │
        │  POST /post  {type, code|path, seq, …}   ── fixed ack ──▶  api.exec / ui.runFileScript
        │                                                               │
        │  GET  /get   ◀── latest payload ──────────────────────────────┘
        │                 (status | result | readback | frames)         one undo group per script
        ▼
   JSON envelope on GET /get
```

The bridge lives in the Cavalry process. Clients only need HTTP access to
`http://127.0.0.1:8080`; they do not need to be VS Code extensions and they do not need a plugin
inside Cavalry beyond Stallion itself.

| Project | Role |
| --- | --- |
| **Stallion** (this repository) | HTTP bridge inside Cavalry, VS Code sender, headless mock |
| [cavalry-mcp](https://github.com/akspro9866-art/cavalry-mcp) | MCP server that batches `_mg` scripts and talks to this bridge |
| [refclone](https://github.com/akspro9866-art/refclone) | Reference-video reproduction pipeline; uses cavalry-mcp and a read-only Stallion client for frame evidence |

## Requirements

| Requirement | Version / notes |
| --- | --- |
| Cavalry | **2.4.0 or newer** — the script refuses to start on an older host |
| VS Code | 1.101.0 or newer, only for the extension and its commands |
| Node.js | 20, 22 or 24 for development, tests and the mock bridge (the CI matrix) |
| Network | Loopback only by default (`127.0.0.1:8080`); no TLS is provided |

The bridge models Cavalry 2.8 in its mock and bundles `@scenery/cavalry-types` 1.x for editor
autocomplete, but the runtime gate is the 2.4.0 check above.

## Build and install

### 1. Build the three bundles

```bash
npm ci
npx cross-env NODE_ENV=production npm run build
```

`npm run build` without `NODE_ENV=production` starts a watch loop, which is useful while developing
but never exits. The production build writes:

| Output | Purpose |
| --- | --- |
| `dist/Stallion.js` | The bundled Cavalry script that runs inside Cavalry |
| `dist/extension.js` | The VS Code extension (CommonJS, `vscode` external) |
| `dist/stallion-mock.mjs` | The headless mock bridge CLI (ESM, executable) |

`dist/` is build output and is not tracked; a fresh checkout has to run the build before using the
extension, the mock CLI or the protocol test. CI does this on every push.

### 2. Get `Stallion.js` into Cavalry

The VS Code extension installs it automatically on activation: it copies `dist/Stallion.js` to
`<home>/AppData/Roaming/Cavalry/Scripts/Stallion.js` on Windows or
`<home>/Library/Application Support/Cavalry/Scripts/Stallion.js` on macOS, and skips the copy when
the installed file already carries the same version banner.

Without VS Code, copy `dist/Stallion.js` into that same `Cavalry/Scripts` folder yourself.

### 3. Start the bridge

Open Cavalry and run **Scripts → Stallion**. The script:

- checks the Cavalry version and throws if it is below 2.4.0,
- reads the optional `stallion.json` (see [Configuration](#configuration)),
- starts `api.WebServer` on the configured host and port,
- serves a status heartbeat on `GET /get`,
- shows a small panel with the version and listening address, plus a documentation link.

The bridge stops if Cavalry saves or opens a scene, because Cavalry resets script contexts. Re-run
**Scripts → Stallion** afterwards. This is a Cavalry limitation, not a bridge crash.

### 4. The VS Code extension (optional)

- **Run from source**: open this folder in VS Code and press `F5` with the *Run Extension*
  configuration (`.vscode/launch.json`). The extension host installs the script and registers the
  three commands.
- **Package a VSIX**: `npx @vscode/vsce package`, then install the generated `.vsix` with
  *Extensions → … → Install from VSIX*. This fork is `private: true` and is not published to the
  marketplace; the upstream listing is the original project, not this fork.

### 5. No Cavalry? Boot the mock

```bash
node dist/stallion-mock.mjs --mock
# or
STALLION_MOCK=1 node dist/stallion-mock.mjs
```

It listens on `127.0.0.1:8080` by default and speaks the same `POST /post` / `GET /get` contract
against an in-memory scene. See [Headless mock bridge](#headless-mock-bridge).

## Use from VS Code

All three commands are in the Command Palette (`View → Command Palette`) and are enabled only while
an editor is active.

### Send To Cavalry

Sends the active editor to Cavalry as a script. A saved document that calls `ui.show()` is sent from
its own file path, so it runs in its own context and window; every other document is wrapped in an
IIFE and written to a temporary `.js` file first. The bridge always receives
`{ "type": "script", "path": "…" }` for this command. If the code contains `ui.add(` but no
`ui.show()`, the extension warns before sending.

Cavalry's Log window should show:

```text
[Info]
JavaScript: Stallion: Script successfully executed
```

### Send To Cavalry As…

Sends the editor text as an expression. TypeScript is stripped first, and any
`/// <reference … />` directive is removed. The expression is applied to every selected layer of the
chosen type; if nothing is selected, a layer of that type is created. Render scripts are applied to
every enabled render queue item, whether or not the Render Manager is open.

| Group | Choices and wire `type` |
| --- | --- |
| Layers | JavaScript Shape (`javaScriptShape`), JavaScript Deformer (`javaScriptDeformer`), JavaScript Utility (`javaScript`), JavaScript Modifier (`javaScriptModifier`), JavaScript Emitter (`javaScriptEmitter`) |
| Shaders | SkSL Shader (`skslShader`), SkSL Filter (`skslFilter`) |
| Renders | Setup Script (`renderSetupExpression`), Pre-Render Script (`preRenderExpression`), Post-Render Script (`postRenderExpression`) |

The result envelope lists `applied` layer ids and `skipped` layer names so a mixed selection is
visible instead of silent. JavaScript layers receive `expression`, JavaScript Shapes receive
`generator.expression`, and SkSL layers receive `code`.

### Insert Cavalry Types

Inserts a `/// <reference path="…" />` at the top of the editor pointing at the bundled
`@scenery/cavalry-types` definitions, and switches the document language to JavaScript when needed.
Pick the context so only the types valid there are exposed:

`Script` (`script`), `Plugin` (`plugin`), `JavaScript Shape` (`shape`), `JavaScript Deformer`
(`deformer`), `JavaScript Utility` (`utility`), `JavaScript Modifier` (`modifier`), `JavaScript Emitter`
(`emitter`), `Render Script` (`render`).

## Configuration

There are two independent sides. Keep them in sync if you change the port.

### Cavalry side — `<Cavalry app data>/stallion.json`

The file lives in Cavalry's application data folder, i.e. the folder returned by
`api.getAppDataFolder()` — usually `%APPDATA%\Cavalry\stallion.json` on Windows and
`~/Library/Application Support/Cavalry/stallion.json` on macOS.

```json
{
  "host": "127.0.0.1",
  "port": 8080,
  "token": ""
}
```

| Key | Default | Notes |
| --- | --- | --- |
| `host` | `127.0.0.1` | Interface the bridge binds to. Changing it exposes the bridge beyond loopback. |
| `port` | `8080` | Integer in 1–65535; anything else falls back to 8080. |
| `token` | `""` | Non-empty enables Bearer-token auth on **both** `POST /post` and `GET /get`. |

All keys are optional. A missing, unreadable or malformed file falls back to the defaults; it never
prevents the bridge from starting. Token auth is applied with `server.setTokenAuthentication(token)`.

### VS Code side — settings

The extension posts to `stallion.address` (default `127.0.0.1`) and `stallion.port` (default `8080`)
read from VS Code settings. These settings are not contributed in the extension manifest, so set
them in `settings.json` when the Cavalry-side port changes. The extension does not read
`stallion.json`; it only sends HTTP requests.

## Bridge protocol (v0.10)

Cavalry's `api.WebServer` exposes exactly two endpoints and one latest-response slot:

- `POST /post` — accept a JSON request and answer with a fixed acknowledgement.
- `GET /get` — serve the latest payload as `text/plain` JSON (the mock serves `application/json`).

There is no router and no binary response channel inside Cavalry. Everything below — results,
readback, snapshots and batch rendering — therefore rides the same queue and the same response slot,
multiplexed by `type` and matched by `seq`.

### Request payload

```json
{
  "type": "script",
  "code": "__result = api.getCavalryVersion();",
  "seq": "demo-1"
}
```

| Key | Type | Applies to | Meaning |
| --- | --- | --- | --- |
| `type` | string | all | Dispatch type. See the table below. |
| `code` | string | scripts and expressions | Code to execute or expression to apply. Ignored when `path` is also present on a script post (the path wins, with a console warning). |
| `path` | string | scripts | Absolute path to a `.js` file. Executed with `ui.runFileScript` in its own context; the way to send UI scripts. |
| `seq` | string or number | all | Echoed back in the result so a client can match request and response. Optional; omit for fire-and-forget. |
| `statePath` | string | scripts | Where to write the execution snapshot. Defaults to `~/.cavalry-mcp/last-execution-state.json`. |
| `beatFrames` | number[] | scripts | Up to 32 frames at which the receipt re-measures the created/selected layers. |
| `diagnostics` | boolean | scripts | Probe every `api.set` attribute path and every `api.connect` link; failures land in `receipt.apiDiagnostics`. |
| `compId` | string | readback, snapshots, render-frames | Target comp. Defaults to the active comp. |
| `frame` / `t` | number | readback, snapshot | Frame at which to read or render. |
| `frames` | number[] | snapshot-batch, render-frames | Frames to capture. |
| `scale` / `resolutionScale` | number | snapshots, render-frames | Percent for snapshots (1–400), multiplier for `render-frames` (0.01–4). |
| `outDir` | string | snapshots, render-frames | Output directory. Forward slashes are recommended; defaults are documented under [Frame capture](#frame-capture). |
| `fileName` | string | snapshots | File stem; unsafe characters are replaced and the result is capped at 80 characters. |
| `layerIds` | string[] | snapshot-batch | Layers to include; defaults to all layers, capped at 200. |
| `attrs` | string[] | readback, snapshot-batch | Explicit attribute allowlist. |
| `attributes` | boolean | readback | When `true`, read every declared attribute instead of the default allowlist (capped at 40). |
| `offset`, `limit` | number | readback | Pagination over the layer list. |
| `budgetMs` | number | readback | Wall-clock ceiling for one slice (5–5000 ms). |
| `includeHidden` | boolean | snapshot-batch | Include hidden layers in the returned layer entries. |
| `format` | string | render-frames | `png_buffer` (default) or `raw_rgba`. |
| `mgCall` | string | readback, snapshots | Names the `_mg.*` helper that produced the request; echoed in error envelopes. |

### Type dispatch

| `type` | Behaviour |
| --- | --- |
| `script` | Execute `code` in a wrapper, or execute the file at `path`. |
| `javaScriptShape`, `javaScript`, `javaScriptModifier`, `javaScriptDeformer`, `javaScriptEmitter` | Apply `code` as the matching expression to selected layers of that type, creating one if the selection is empty. |
| `skslShader`, `skslFilter` | Apply `code` to selected SkSL layers of that type. |
| `renderSetupExpression`, `preRenderExpression`, `postRenderExpression` | Apply `code` to every enabled render queue item. |
| `state`, `layers` | Scene readback. Both run the same walk and differ only in the returned `kind`. |
| `snapshot` | Render one frame and report the file, size, timing and scene digest. |
| `snapshot-batch` | Render up to 64 frames in one host call, with per-frame layers and boxes. |
| `render-frames` | Render up to 2000 frames at verification resolution in one call. |
| `__stallion_result__` | Internal loopback channel. Clients must not send it. |

Requests missing `type`, or missing both `code` and `path`, are logged to Cavalry's console and do
**not** produce a new `/get` payload. Always send `seq` and enforce your own timeout.

### Result envelope

Every handled request replaces the payload served by `GET /get`. A script result looks like this:

```json
{
  "type": "__stallion_result__",
  "kind": "result",
  "seq": "demo-1",
  "ok": true,
  "result": 42,
  "state": { "...": "execution snapshot" },
  "receipt": {
    "sceneStateHash": "0123456789abcdef",
    "consoleDiagnostics": [],
    "beatBBoxes": {}
  }
}
```

- `ok` is `true` only when the code completed. A thrown error returns `ok: false`, `error` from
  `error.toString()`, and `stack`.
- `result` is whatever the script assigned to `__result` or returned. It must be JSON-serialisable;
  otherwise the bridge reports `Script result was not serialisable`.
- File scripts (`path`) report `{ ok: true, note: "file script executed (no captured result)" }`
  because Cavalry's `ui.runFileScript` does not return a value.
- Expression posts report `applied` and `skipped` lists instead of a single result.
- Readback and capture types reshape their inner document to the top level and report their own
  `kind` (`state`, `layers`, `snapshot`, `snapshot-batch`, `render-frames`).

### Client flow

1. `POST /post` with a unique `seq`.
2. Poll `GET /get` until the parsed JSON has that `seq`, or a deadline expires.
3. Branch on `ok`; read `result` / `error`, or the readback/frame fields.
4. Remember that the last payload stays served until the next handled post. A cached body with a
   different `seq` belongs to an earlier request, so match `seq` before trusting it.

```js
const seq = crypto.randomUUID()
const headers = { "content-type": "application/json" }

await fetch("http://127.0.0.1:8080/post", {
  method: "POST",
  headers,
  body: JSON.stringify({ type: "script", code: "__result = 1 + 1", seq })
})

const deadline = Date.now() + 20_000
let payload
while (Date.now() < deadline) {
  payload = await (await fetch("http://127.0.0.1:8080/get")).json()
  if (payload.seq === seq) break
  await new Promise((resolve) => setTimeout(resolve, 20))
}
if (payload?.seq !== seq) throw new Error("bridge timeout")
console.log(payload.ok, payload.result)
```

With token auth enabled, add `authorization: "Bearer <token>"` to both requests. The VS Code
extension does not send a token, so leave `stallion.json` token empty when using the extension.

### Status heartbeat

Before any request has run, `GET /get` returns the startup heartbeat:

```json
{
  "kind": "status",
  "stallion": "0.10.0",
  "cavalry": "2.8.0",
  "scene": "C:/work/scene.cv",
  "frame": 0,
  "unSaved": false,
  "capabilities": {
    "receipt": true,
    "renderFrames": true,
    "introspect": ["state", "layers", "snapshot", "snapshot-batch"],
    "errorEnvelope": 1,
    "mock": false
  },
  "ts": 1760000000000
}
```

`capabilities` is the feature handshake. `mock` is `true` only for the headless bridge. `introspect`
lists the message types accepted by this bridge, not URL routes.

### Error envelopes

Failures carry a stable code so a client does not have to match prose:

```json
{
  "ok": false,
  "kind": "snapshot",
  "seq": "demo-1",
  "code": "STALLION_NO_FRAME",
  "error": "snapshot requires a numeric `frame` (or `t`)."
}
```

| Code | Emitted when |
| --- | --- |
| `STALLION_EXEC_FAILED` | `api.exec` could not run a readback, snapshot or snapshot-batch script |
| `STALLION_NO_ACTIVE_COMP` | No comp is open or selected |
| `STALLION_NO_FRAME` | A snapshot has no numeric frame, or a batch has an empty frame list |
| `STALLION_RENDER_FAILED` | `renderPNGFrame` threw or produced a zero-byte file |
| `STALLION_BAD_REQUEST` | The mock rejected an oversized introspection request body (HTTP 413) |

The envelope may also carry `mgCall`, `layerId`, `attrPath` and `stack`; optional keys are omitted
rather than set to `null`. The mock answers unauthenticated requests with HTTP 401
`{ "error": "unauthorized" }` instead of an envelope.

## Execution receipts and state snapshots

Every `code` post that reaches the wrapper produces a receipt after its body has run (for a
non-atomic script, after its undo group closes). File-path scripts and expression posts do not get
one because they do not pass through the wrapper, and a post that `api.exec` cannot start returns a
plain error envelope. The receipt is deterministic: identical scenes produce identical hashes, and
any change to node ids, types, keyframe counts or connections within the first 400 layers changes
the hash.

| Receipt field | Contents | Bounds |
| --- | --- | --- |
| `sceneStateHash` | Dual-lane FNV-1a digest of node ids, types, keyframe counts and incoming connections. Fast and deterministic, **not** cryptographic. | First 400 layers |
| `consoleDiagnostics` | `console.log` / `info` / `warn` / `error` entries captured while the script ran, plus schema diagnostics in the mock | 64 entries × 240 characters |
| `beatBBoxes` | World-space boxes of created/selected layers at each `beatFrames` frame, including `pivotX`, `pivotY` and `rotation`; the playhead is restored afterwards | 32 frames × 50 layers |
| `apiDiagnostics` | With `diagnostics: true`: `invalidAttrs` found by probing `api.set`, and `failedConnections` found by re-reading `api.connect` links | Per call |

The wrapper also writes a compact **execution snapshot** to `statePath` (default
`~/.cavalry-mcp/last-execution-state.json`):

```json
{
  "seq": "demo-1",
  "status": "ok",
  "errorStack": null,
  "createdLayerIds": ["basicShape#4"],
  "activeSelection": ["basicShape#4"],
  "compInfo": {
    "id": "compNode#1",
    "name": "Comp 1",
    "fps": 24,
    "startFrame": 0,
    "endFrame": 215,
    "resolution": [1920, 1080],
    "width": 1920,
    "height": 1080
  },
  "boundingBoxes": {
    "basicShape#4": { "x": 0, "y": 0, "width": 200, "height": 120, "centre": { "x": 100, "y": 60 } }
  },
  "durationMs": 37,
  "writtenAt": "2026-11-06T12:00:00.000Z"
}
```

The wrapper stashes the snapshot on `globalThis.__stallionState` for shared script contexts; atomic
scripts are expected to publish their state there themselves. Boxes are limited to 50
created/selected layers. If the file cannot be written, the bridge retries with a minimal
`{ seq, status, errorStack, writeFailed }` document so a diagnosis is still possible.

### The atomic marker

A script whose source starts with `/* cavalry-mcp:atomic */` is treated as already wrapped:

- the bridge does not add its own `api.startUndoGroup("AI Motion Batch")` / `endUndoGroup()` pair,
  and does not capture pre-execution telemetry;
- the script manages its own transaction; if it publishes `globalThis.__stallionState` with the
  matching `seq`, the wrapper attaches that state to the envelope;
- the receipt is still attached to the result.

This is how `cavalry-mcp` batch scripts run. A raw ad-hoc script gets the automatic wrapper: a
function scope (IIFE), an undo group named `AI Motion Batch`, and the group is closed in `finally`
even when the script throws.

### How results travel back

The wrapper delivers its JSON through two channels and whichever reaches the bridge first wins:

1. a `globalThis.__stallionResult__` stash, for builds that share the script context with Stallion;
2. a loopback `api.WebClient` POST with `type: "__stallion_result__"`, for isolated contexts.

Bursts are drained in the same callback (up to 64 extra queued posts), so a batch of scripts does
not wait one tick per post.

## Scene readback

`type: "state"` and `type: "layers"` execute the same defensive walk inside `api.exec`, on Cavalry's
UI thread. They differ only in the `kind` they report. Readback is read-only: the generated runtime
uses the atomic marker, so it opens no undo group.

### Parameters

| Key | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `compId` | active comp | — | — |
| `frame` | current playhead | ±1e9 | Values are evaluated at this frame; the playhead is restored. |
| `offset` | `0` | ≥ 0 | Index into the comp's layer list. |
| `limit` | `200` | 1–1000 | Maximum layers in this slice. |
| `attrs` | `position.x`, `position.y`, `scale.x`, `scale.y`, `rotation`, `opacity` | ≤ 40 names | Anything unusual must be requested explicitly. |
| `attributes` | `false` | — | `true` reads every declared attribute, capped at 40, and adds `attributeNames`. |
| `budgetMs` | `120` | 5–5000 | Wall-clock ceiling for the slice. |

### Response

```json
{
  "ok": true,
  "kind": "state",
  "seq": "layers-1",
  "compId": "compNode#1",
  "frame": 42,
  "total": 37,
  "offset": 0,
  "returned": 37,
  "truncated": false,
  "nextOffset": -1,
  "elapsedMs": 18,
  "layers": [
    {
      "id": "basicShape#4",
      "ref": "basicShape#4",
      "semanticId": "card_spring_12",
      "semanticSlug": "card_spring",
      "type": "basicShape",
      "name": "Card Spring",
      "path": ["card_spring#12"],
      "depth": 0,
      "topLevel": true,
      "parent": null,
      "parentName": null,
      "hidden": false,
      "visible": true,
      "inFrame": 0,
      "outFrame": 215,
      "boundingBox": { "x": 0, "y": 0, "width": 200, "height": 120, "pivotX": 100, "pivotY": 60, "centre": { "x": 100, "y": 60 } },
      "worldBoundingBox": { "x": 0, "y": 0, "width": 200, "height": 120, "pivotX": 100, "pivotY": 60, "centre": { "x": 100, "y": 60 } },
      "compBoundingBox": { "x": 0, "y": 0, "width": 200, "height": 120, "pivotX": 100, "pivotY": 60, "centre": { "x": 100, "y": 60 } },
      "pivot": { "x": 100, "y": 60 },
      "deformers": [],
      "childCount": 0,
      "attrs": { "position.x": 100, "position.y": 60, "opacity": 1 },
      "connected": [],
      "unreadable": []
    }
  ]
}
```

Layer entry highlights:

- `ref` is `<layerType>#<index>`, Cavalry's canonical addressing that survives save/reload.
- `semanticId` is `<slug>_<index>`, where the slug is derived from the layer name; `semanticSlug` is
  the bare slug. Both are reproducible from the scene alone. They are what a subsequent `_mg.patch`
  refinement keys against.
- `worldBoundingBox` and `compBoundingBox` are explicit; the legacy `boundingBox` field mirrors the
  world box (or the comp box when the world box is unavailable) and remains for older callers. All
  three carry `pivotX`/`pivotY` and `centre` when a pivot is readable.
- `deformers` classifies child layers that deform or distribute geometry (subMesh, align, duplicator,
  stagger, falloff, noise, oscillator, behaviours, and similar), capped at 16.
- `connected` lists attributes fed by another layer or behaviour at the requested frame, so a
  procedural rig is visible without a second request. `outConnections` lists the outgoing links for
  the requested attributes, capped at 16.
- With `attributes: true`, `attributeNames` lists every declared attribute and `attrs` carries up to
  40 of them.
- `unreadable` lists requested attributes whose type does not expose a readable value. One bad
  attribute never aborts the walk.
- `visible` accounts for both the hidden flag and the layer's in/out range at the requested frame.

### Pagination and truncation

A slice that hits `limit` or `budgetMs` returns `ok: true` with `truncated: true` and `nextOffset`
set to the first unprocessed index. That is a partial success with a cursor, not an error. Ask for
the next slice with `offset: nextOffset`. A `nextOffset` of `-1` means the walk finished.

The `limit` bounds one slice; `budgetMs` is the defence against a single long freeze. `api.exec` runs
synchronously on Cavalry's UI thread and cannot be interrupted from outside, so the walk checks the
clock between layers and returns a resumable cursor instead of overrunning.

## Frame capture

All three capture types move the playhead (and, when `compId` is supplied, the active comp), render
with `api.renderPNGFrame`, report the resulting files in the same call, and restore the previous
state. None of them opens an undo group. The snapshot variants also verify existence and file size
before answering; `render-frames` reports the size it reads back.

### `snapshot` — one frame

| Key | Default | Notes |
| --- | --- | --- |
| `frame` or `t` | required | Numeric frame. Missing or non-numeric returns `STALLION_NO_FRAME`. |
| `compId` | active comp | — |
| `scale` | `100` | **Percent**, clamped to 1–400. |
| `outDir` | `~/.stallion/snapshots` | Use forward slashes; the value crosses the JSON boundary as a scene URI. |
| `fileName` | `snapshot-<frame padded>` | Sanitised stem; `.png` is appended. |

The response reports `file`, `fileName`, `compId`, `frame`, `renderedAt`, `renderedAtIso`,
`restoredFrame`, `exists`, `sizeBytes`, `frameHash`, and `error`/`code` on failure. `frameHash` is a
16-hex digest of the frame number, comp id and evaluated top-level boxes (first 64 layers) — a
fingerprint of the scene at that frame, not a hash of the PNG bytes. The live host cannot read its
own PNG back; the mock adds `contentHash` (SHA-256) and inline pixels because it is real Node.

### `snapshot-batch` — critical frames in one round trip

| Key | Default | Notes |
| --- | --- | --- |
| `frames` | required | 1–64 frames. Deduped, sorted ascending, capped at 64. |
| `compId` | active comp | — |
| `scale` | `100` | Percent, 1–400. |
| `outDir` | `~/.stallion/snapshots` | Files are `<fileName>-<frame padded>.png`. |
| `fileName` | `snapshot-batch` | Sanitised stem. |
| `layerIds` | all layers | Capped at 200. |
| `attrs` | none | Up to 16 attribute names added to each layer entry. |
| `includeHidden` | `false` | When false, hidden/out-of-range layers are omitted from the returned list. |

Each frame entry reports `file`, `exists`, `sizeBytes`, `renderedAt`, `frameHash`, `layers` and
`error`/`code`. Each layer reports `id`, `ref`, `type`, `name`, `visible`, `bbox` (with `pivotX`,
`pivotY`, `centre`) and optional `attrs`. The batch as a whole reports `requested`, `rendered`,
`errors`, `restoredFrame` and `elapsedMs`.

This is the path a convergence loop should use: six critical frames cost one host round trip instead
of six.

### `render-frames` — verification-resolution batch

`type: "render-frames"` is the batch path for render verification rather than per-layer readback.

| Key | Default | Notes |
| --- | --- | --- |
| `frames` | required | 1–2000 integer frames. |
| `resolutionScale` | `0.5` | Multiplier, clamped to 0.01–4. `scalePercent` in the response is 1–400. |
| `format` | `png_buffer` | `png_buffer` or `raw_rgba`. |
| `compId` | active comp | — |
| `outDir` | `~/.stallion/frames/<seq>` | `outDir` is used as given; the default uses the sanitised `seq` (or `batch`). |
| `seq` | optional | Also names the default output folder. |

Live bridge response:

```json
{
  "ok": true,
  "kind": "render-frames",
  "seq": "verify-1",
  "format": "png_buffer",
  "scale": 0.5,
  "scalePercent": 50,
  "compId": "compNode#1",
  "width": 960,
  "height": 540,
  "outDir": "C:/work/frames/verify-1",
  "rendered": [{ "frame": 0, "file": "C:/work/frames/verify-1/frame-000000.png", "bytes": 18234 }],
  "failed": [],
  "inlineNote": null
}
```

Every rendered file is listed with its byte size; failures are per-frame and do not abort the rest of
the batch. `ok` is true when at least one frame rendered. Because Cavalry's script host has no binary
readback, the live bridge always writes files (and acknowledges `raw_rgba` with an explanatory
`inlineNote`); the mock serves real inline buffers. Read the files over localhost.

## Headless mock bridge

`dist/stallion-mock.mjs` is a dependency-free Node HTTP server that speaks the same wire contract
against an in-memory Cavalry 2.8 scene. It exists so CI can exercise the whole stack:

```text
refclone → cavalry-mcp (injects _mg) → stallion --mock → synthetic frames
```

```bash
node dist/stallion-mock.mjs --mock
```

| Flag | Meaning |
| --- | --- |
| `--mock` | Boot condition. Without it (or `STALLION_MOCK=1`) the CLI prints usage and exits 0. |
| `--host H` | Bind host; default `STALLION_HOST` or `127.0.0.1`. |
| `--port N` | Port; default `STALLION_PORT` or `8080`. Use `0` for an ephemeral port in tests. |
| `--token T` | Require `Authorization: Bearer T`; default `STALLION_TOKEN`. |
| `--lax` | Disable strict schema validation; unknown attributes are still reported as diagnostics but are applied anyway. |
| `--verbose` | Echo captured console output to stderr. |

The mock starts with an empty scene. Scripts create comps and layers through the same `api` surface,
with typed attributes, parent/deformer links, connections, keyframes (linear, weighted cubic Bézier
and named easing presets), undo groups, a playhead and a deterministic software rasterizer that emits
real PNGs. Readback and snapshot requests run the **same runtime source strings** the live bridge
hands to `api.exec`, so CI exercises the shipped walk rather than a TypeScript reimplementation.

### Routes

| Route | Methods | Live Cavalry | Mock |
| --- | --- | --- | --- |
| `/` | GET | — | Text index of the mock surface |
| `/get` | GET | Latest payload (text/plain) | Latest payload (`application/json`) |
| `/post` | POST | Request queue, fixed ack | Same contract, `{ "ok": true }` ack |
| `/render-frames` | POST | — | Literal route; streams framed raw bytes when `Accept: application/octet-stream` |
| `/state`, `/layers` | GET, HEAD, POST | — (use `type` on `/post`) | Path-shaped convenience; same envelope as the type-shaped request |
| `/frame`, `/snapshot` | GET, HEAD, POST | — | Single-frame snapshot, with inline pixels by default (`?inline=0` disables) |
| `/snapshot-batch` | GET, HEAD, POST | — | Batch snapshot; `?frames=0,24,48`, `?layerIds=…`, `?attrs=…` |

Path-shaped routes answer directly rather than ack-then-poll because they have no queue contract to
honour. A JSON body is merged over the query string. Requests are capped at 32 MiB and unauthenticated
requests receive HTTP 401.

### What the mock adds

- **Inline pixels**: `bufferBase64` on `render-frames` entries (first 64 frames), `pngBase64` on
  `snapshot` and `snapshot-batch` (first 16 frames), and a raw binary stream on the literal
  `/render-frames` route. The live bridge cannot do any of this.
- **`contentHash`**: SHA-256 of each snapshot PNG (single and batch), because the mock can read its
  own files.
- **A receipt on `render-frames`**, matching the script-result receipt shape.
- **Path-shaped introspection** as an alternative to the `type`-shaped requests available to the
  live bridge.

The heartbeat differs only in values: `stallion: "0.10.0-mock"`, `cavalry: "2.8.0-mock"`,
`scene: "mock://scene.cv"`, and `capabilities.mock: true`.

## Safety and atomicity

- **One undo group per script.** A non-atomic code post runs inside a function scope with
  `api.startUndoGroup("AI Motion Batch")` and `api.endUndoGroup()` in `finally`. A thrown script still
  closes its group; Cavalry's undo stack shows one step for the batch.
- **No automatic rollback.** If a script throws halfway, the edits it already made remain in the scene
  inside that undo step until a user undoes it. The receipt and execution snapshot are the audit
  trail; nothing silently reverts.
- **Reads do not mutate.** `state`/`layers` and the snapshot runtimes are marked atomic;
  `render-frames` is dispatched directly. None opens an undo group, and all restore the playhead and
  active comp.
- **Local by default.** The server binds `127.0.0.1`. Changing `host` exposes an unauthenticated
  scripting endpoint to the network unless you also set `token`. There is no TLS.
- **Bounded work.** Readback paginates and checks `budgetMs`; snapshots cap frames; render batches cap
  frames and scale; receipts cap console output and beat measurements. These limits exist because
  everything runs synchronously on Cavalry's UI thread.
- **Single result slot.** The bridge serves one payload at a time. Concurrent clients can overwrite
  each other's result; serialise requests and match `seq`. A malformed legacy post can leave the
  previous payload in place, so always enforce a timeout.

## Development

```bash
npm ci
npm run dev                  # esbuild watch for all three bundles
npx cross-env NODE_ENV=production npm run build   # one-shot production build
npm test                     # lint + protocol smoke + node:test suites
npm run test:vscode          # extension-host suite (downloads Electron; not in CI)
npm run lint                 # ESLint
```

`npm test` runs `eslint .`, then `node test/protocol/bridge-protocol.mjs` (nine protocol scenarios
against the built `dist/Stallion.js` in a sandboxed `api`/`ui`/`cavalry` realm), then
`node test/run.mjs`, which recursively collects every `*.test.mjs` under `test/` and runs it with
Node's test runner: **25 tests** covering readback, snapshots, batch rendering, receipts, expression
dispatch, `seq` matching and token auth.

CI runs on `ubuntu-latest` and `windows-latest` across Node 20, 22 and 24. It performs a production
build, then `npm test`. The VS Code extension-host suite is deliberately excluded because it needs a
downloaded Electron build; run it locally when changing command wiring.

### Repository layout

```text
src/cavalry/Stallion.ts              Entry: version gate, stallion.json, WebServer setup, UI
src/cavalry/modules/Callbacks.ts     Dispatch, script wrapper, receipt capture, render-frames
src/cavalry/modules/Introspect.ts    Readback and snapshot runtime scripts, error envelopes
src/cavalry/modules/Receipt.ts       Deterministic receipt runtime (FNV-1a, console, beat boxes)
src/vscode/extension.ts              Command registration and script installation
src/vscode/commands/                 post, post as, insert types, install, shared helpers
src/mock/                            In-memory scene, mock api, rasterizer, HTTP server
src/node/mock-cli.ts                 `--mock` CLI entry
scripts/build.mjs                    esbuild bundle definitions
test/protocol/                       Sandboxed wire-protocol smoke test against dist/Stallion.js
test/mock/                           node:test suites for the mock bridge and introspection
test/helpers/                        Windows-safe scratch-tree teardown shared by the suites
test/vscode/                         Extension-host runner and Mocha suite (local only)
test/run.mjs                         Recursive *.test.mjs discovery for Node's test runner
dist/                                Build output (ignored; run npm run build first)
```

Packaged `.vsix` files are build artifacts too: they are ignored by Git and excluded from the
extension bundle. Generate one with `npx @vscode/vsce package` when you need to install it.

## Limitations

- **Cavalry's WebServer is not an HTTP framework.** It has exactly `/post` and `/get`, one response
  slot and no binary channel. Readback and captures are message types on `/post`, not REST resources;
  only the mock adds path-shaped routes.
- **Results are not queued.** `GET /get` serves the latest payload, and the next handled post replaces
  it. Match `seq`; do not assume a result belongs to your request just because it is a result.
- **No binary readback live.** The bridge cannot return PNG bytes or content-hash a file it just wrote.
  It reports paths, sizes, timestamps and a scene digest; read the files over localhost. `raw_rgba` is
  file-only on the live bridge.
- **No automatic rollback.** A failed script leaves its already-applied edits inside one undo group.
- **UI-thread execution.** Every script and capture blocks Cavalry while it runs. `budgetMs` bounds
  readback slices, but a large `render-frames` batch is still synchronous work.
- **Caps are deliberate**: 32 beat frames, 50 receipt layers, 400 layers in the scene hash, 64 console
  entries, 1000 readback layers per slice, 64 snapshot-batch frames, 2000 render-frames frames,
  200 layer ids and 16 attrs per batch entry.
- **Frame hashes are scene fingerprints**, not image hashes. A hash match means the frame number,
  comp id and evaluated top-level geometry matched; it does not prove the pixels are identical. The
  PNG file is the visual evidence.
- **Scene save/open stops the bridge.** Cavalry resets script contexts; re-run **Scripts → Stallion**.
- **`ui.scriptLocation` points at a temporary path** when the VS Code document has not been saved.
- **No marketplace release from this fork**, no TLS, and token auth is optional. Leave the default
  loopback bind unless you know why you are changing it.

## Compatibility and versioning

- Protocol baseline: upstream Stallion's `POST /post` with `type` + `code`/`path`; `seq` optional;
  default `http://127.0.0.1:8080`.
- 0.9.0 added the result channel, status heartbeat, `stallion.json`, token auth and applied/skipped
  lists. 0.10.0 added receipts, scene readback, snapshots, `render-frames`, the mock bridge and CI.
- Clients can feature-detect the 0.10 surface from `capabilities` on the heartbeat: `receipt`,
  `renderFrames`, `introspect` and `errorEnvelope`.
- The version is shown in the Stallion panel and in the heartbeat's `stallion` field. The source
  version lives in `src/cavalry/modules/Callbacks.ts` (`VERSION`); the package version is `0.10.0`.
- cavalry-mcp 3.x and refclone's read-only client target this 0.10 surface. The upstream marketplace
  extension remains the original project, not this fork.

## Credits and license

Stallion was created by [Scenery](https://scenery.io) and is maintained upstream at
[scenery-io/stallion](https://github.com/scenery-io/stallion). This fork keeps the MIT license and
the original credits.

Huge thanks to Cavalry for sponsoring the upstream project. Interested in sponsoring? Send a message
via [scenery.io/support](https://scenery.io/support).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./images/cavalry-white.png">
  <img alt="Cavalry" src="./images/cavalry-black.png" width="300">
</picture>

#### Icon credits

The icon is [Horse](https://thenounproject.com/icon/horse-2128337/) by Buztas Linggar from
[Noun Project](https://thenounproject.com/).

MIT — see [LICENSE](LICENSE). Copyright (c) 2022 Remco Janssen and contributors.
