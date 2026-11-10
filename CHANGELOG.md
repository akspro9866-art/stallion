# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- `Added` for new features
- `Changed` for changes in existing functionality
- `Deprecated` for soon-to-be removed features
- `Removed` for now removed features
- `Fixed` for any bug fixes
- `Security` in case of vulnerabilities

## [Unreleased]

### Added

- Tag-triggered release workflow (`.github/workflows/release.yml`) plus
  `scripts/release-notes.mjs`: pushing a `v*` tag will run CI and create a
  GitHub Release from the matching CHANGELOG section. Preparation only —
  no tag or release was published in this pass.

### Security

- Startup warning when the bridge listens without a token configured
  (warning only — auth remains optional for backwards compatibility).

### Proposed

- Making token auth mandatory (at least for non-loopback binds) is a
  deliberate breaking change reserved for a future release decision; this
  pass only warns and documents the risk. Not shipped here.

## [0.11.0] - 2026-11-07

Fast-loop endpoints for the deterministic refinement pipeline (Stage 4.5).

### Added

- **`batch_inspect`** — single-roundtrip multi-frame readback. Scrubs the
  playhead across up to 64 requested frames, reads every target layer's
  world-space bounding box (short form `x/y/w/h/cx/cy`) and requested
  attribute values, reports `compFrameRate`/`compResolution`, restores the
  playhead and answers with one compact timeline matrix. No pixels are
  rendered — geometry-only, so a local solver can poll it without paying the
  PNG render cost `snapshot-batch` exists for.
- **`checkpoint` / `rollback`** — fast scene state checkpointing under a
  caller-chosen `snapshotId`. The checkpoint serializes managed layers'
  attribute values, keyframes (frame + evaluated value), in/out frames,
  parenting, hidden flags and incoming connections into a version-1 state
  document, kept in memory on the bridge (bounded, oldest evicted) and written
  to a fast temp copy `<temp>/stallion-checkpoint-<id>.cv`. The rollback is one
  host call: delete post-checkpoint layers, re-create deleted ones, re-apply
  values/keyframes/timing/parenting, restore connections (best effort) and the
  playhead. Unknown snapshot ids fail as `STALLION_UNKNOWN_SNAPSHOT`.
- **`render_frame_fast`** — one downscaled render for the verify loop:
  `scaleFactor` 0.1–1 (or legacy `scale` percent), default output directory is
  the host temp folder, same in-call verification fields as `snapshot`
  (`sizeBytes`, `exists`, `frameHash`, `restoredFrame`). The mock bridge
  additionally inlines `pngBase64`/`width`/`height`/`contentHash`; the live
  bridge reports `inline: false` with a note (no binary read in the script
  host).
- The mock bridge serves all three as literal paths (`/batch_inspect`,
  `/checkpoint`, `/rollback`, `/render_frame_fast`) answering the identical
  envelopes, and the heartbeat `capabilities.introspect` lists every new kind.

### Fixed

- **Live `_mg` TDZ in `/batch-step` manifests**: when the startup preload had
  defined `globalThis._mg` (every real Cavalry session), the generated script's
  preload branch returned before the vendored runtime's `const _mg` ever
  initialized, so the manifest interpreter — which closes over `_mg` — failed
  every layer creation with "Cannot access '_mg' before initialization". The
  two bootstrap branches now live in separate function scopes, and a
  `preloadMg` mock mode (one persistent vm context carrying the preload) keeps
  the mock executing the exact branch a live shared context takes.

### Added

- **`npm run deploy`** — builds the production bundle and installs it to the
  Cavalry user Scripts folder (`%APPDATA%\Cavalry\Scripts\Stallion.js` on
  Windows), verifying the version banner and a byte-identical readback, and
  printing the deployed path, byte size and SHA-256.

### Notes

- Backward compatible: existing `type`s, envelopes and the `snapshot` PNG kind
  are unchanged; the new kinds are additive dispatch entries on POST /post.

## [0.10.0] - 2026-11-01

Telemetry, batch frame verification, and a headless mock bridge for CI.

### Added

- **Deterministic post-execution receipt**: every script result now carries
  `receipt: { sceneStateHash, consoleDiagnostics, beatBBoxes }`.
  `sceneStateHash` is a fast deterministic dual-lane FNV-1a digest of active
  node IDs, attribute connections and keyframe counts (identical scenes hash
  identically; any mutation changes the hash). `consoleDiagnostics` captures
  `console.warn`/`error`/`log` output raised while the script ran instead of
  swallowing it. `beatBBoxes` re-measures world-space bounding boxes (plus
  pivot and rotation) of the created/selected layers at the caller's
  `beatFrames` and restores the playhead. Scripts may pass
  `diagnostics: true` to also probe every `api.set` attribute path
  (`getAttributeDefinition` + read-back) and every `api.connect` link
  (endpoint existence + `getInConnection` read-back); failures land in
  `receipt.apiDiagnostics`.
- **Batch frame verification — `POST /post {type:"render-frames"}`**: one
  bridge call renders a list of frames at verification resolution
  (`resolutionScale`, default 0.5; `format: "png_buffer" | "raw_rgba"`) via
  `api.renderPNGFrame`, then reports per-frame files, sizes and the comp
  resolution. Playhead and active comp are always restored. The live bridge
  reports file references (Cavalry's scripting host has no binary readback —
  `raw_rgba` is acknowledged with an inline note); the mock bridge serves
  real inline buffers.
- **Headless mock bridge (`--mock`)**: `node dist/stallion-mock.mjs --mock`
  (or `STALLION_MOCK=1`) boots the same wire contract against an in-memory
  Cavalry 2.8 scene graph — schema-validated node/attribute calls with
  recorded diagnostics, linear / weighted cubic Bézier / magic-easing
  interpolation, undo groups, playhead, connections and a deterministic
  software rasterizer that emits real PNG buffers for `render-frames`. The
  mock also exposes a literal `POST /render-frames` route that streams raw
  bytes when called with `Accept: application/octet-stream`, so CI can drive
  the full stack (refclone → cavalry-mcp → stallion) without a GUI.
- **CI**: first GitHub Actions workflow — build + ESLint + the protocol suite
  + the mock-bridge suite on ubuntu/windows across Node 20/22/24. The VS Code
  extension-host suite moved to `npm run test:vscode` (needs a real Electron
  host, not CI-able headless).

### Changed

- `GET /get` status heartbeat now carries
  `capabilities: { receipt, renderFrames, mock }` so clients can detect the
  upgraded bridge.
- The generated script wrapper restores the captured `console` methods even
  when the script throws.

## [0.9.0] - 2026-10-25

Fork of [scenery-io/stallion](https://github.com/scenery-io/stallion) focused on
making the bridge usable from automation tools (MCP servers, scripts) — see
`Bridge protocol` in the README.

### Added

- **Result channel on `GET /get`**: script return values and errors are now
  served over HTTP (via `api.WebServer.setResultForGet`). Posted scripts may
  include a `seq` key; the served result echoes it so callers can match
  requests to results. Results are delivered through a globalThis stash when
  Cavalry shares the script context, and through a loopback `api.WebClient`
  POST otherwise — whichever works in the running build.
- **Status heartbeat**: before any script has run, `GET /get` serves
  `{kind:"status", stallion, cavalry, scene, frame, unSaved, ts}`.
- **Optional configuration file** `<Cavalry app data>/stallion.json` with
  `host`, `port` and `token` keys (fixes the hardcoded-port known issue).
- **Optional token authentication** (`token` in `stallion.json`) for both POST
  and GET.
- Expression/render application results now report `applied` and `skipped`
  layer lists through the result channel.
- Queued posts are drained in one callback tick instead of one per tick.

### Changed

- Error payloads for missing files, failed executions and unexpected types are
  also served on the result channel — the fixed HTTP ack no longer hides
  failures from HTTP clients.

## [0.8.0] - 2026-10-02

### Added

- Types for Cavalry 2.8.0

## [0.7.0] - 2026-05-06

### Added

- Select a scripting context in `Insert Cavalry Types`
- Types for Cavalry 2.7.0

## [0.6.3] - 2026-01-18

### Fixed

- Cavalry types were ignored in the extension package

## [0.6.2] - 2026-01-18

### Fixed

- Cavalry types did not get installed

## [0.6.1] - 2026-01-17

### Changed

- Cavalry script is now minified

### Fixed

- Commands were not enabled correctly

## [0.6.0] - 2025-12-27

### Added

- Send to Cavalry as Setup, Pre-Render and Post-Render Script

### Changed

- Commands only show when an editor is active
- Whitespace gets trimmed before and after an expression

## [0.5.0] - 2025-12-27

### Added

- Support for TypeScript

### Changed

- Increased the minimum required `vscode` version to 1.101.0

## [0.4.0] - 2025-11-03

### Added

- Send to Cavalry as SkSL Filter

## [0.3.1] - 2024-08-14

### Added

- Removal of Triple-Slash Directives in expressions

### Fixed

- Comments on last line breaking script execution
- Scripts ran by `api.exec` not wrapped in an IIFE
- Mixed path separators in the Triple-Slash Directive on Windows

## [0.3.0] - 2024-08-05

### Added

- Send to Cavalry as expression (JavaScript and SkSL)
- Send data to Stallion from other tools
- Link to documentation in the Stallion UI

### Changed

- The data object expected by Stallion

## [0.2.5] - 2023-06-01

### Added

- Types for Cavalry 1.5.6

## [0.2.4] - 2023-04-28

### Fixed

- Latest types not being installed

## [0.2.3] - 2023-04-27

### Added

- Types for Cavalry 1.5.5

## [0.2.2] - 2023-04-25

### Added

- Types for Cavalry 1.5.3 and 1.5.4

## [0.2.1] - 2023-04-12

### Fixed

- ENOENT error when the Cavalry scripts folder doesn't exist
- Mentions the Stallion script panel in the readme

### Removed

- Install command from package

## [0.2.0] - 2023-03-06

### Added

- Scripts with a UI now run in a separate context
- Stallion is installed automatically
- Types for Cavalry 1.5.2

### Changed

- Minimum supported version is Cavalry 1.5.2
- Editor contents are saved to a temp file
- Scripts with a UI automatically focus Cavalry
- Scripts are received quicker by the server

### Removed

- `Install Stallion` command in favor of auto-install
- Support for Cavalry versions lower than 1.5.2

### Fixed

- `ui.scriptLocation` returned the path of the Stallion script

## [0.1.1] - 2023-02-14

### Fixed

- Language is automatically set to JavaScript with the `Insert Cavalry Types` command
- Consistent slashes in reference path
- More detailed instructions in readme

## [0.1.0] - 2023-02-14

### Added

- `Insert Cavalry Types` command
- Extension icon

## [0.0.2] - 2022-11-18

- Fixes ESM errors

## [0.0.1] - 2022-11-18

- Working alpha version
