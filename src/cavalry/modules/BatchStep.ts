/**
 * `/batch-step` — execute + step + measure + render in one atomic round trip.
 *
 * ## Why this is a message type, not a URL route
 *
 * Exactly like `state` / `layers` / `snapshot` (see Introspect.ts): Cavalry's
 * `api.WebServer` exposes only `GET /get` and `POST /post`, so a literal
 * `POST /batch-step` cannot be served from inside Cavalry. The bridge
 * multiplexes over the one queue it has — a POST /post payload whose `type`
 * is `batch-step` is dispatched to a dedicated handler and the answer comes
 * back on `GET /get` with the caller's `seq` and `kind: "batch-step"`. The
 * Node mock bridge has a real router and *also* serves a literal
 * `POST /batch-step` path that returns the identical envelope.
 *
 * ## What one call does
 *
 *   1. executes `script` (a JS body) and/or applies `dslManifest` (the
 *      declarative `_mg` manifest interpreted by the vendored
 *      `__mgApplyManifest` runtime) inside one Undo group;
 *   2. steps the playhead across `sampleFrames`, reading each target layer's
 *      world bounding box (`api.getBoundingBox(id, true)`, centroid included),
 *      rotation and opacity;
 *   3. optionally renders every sampled frame with `api.renderPNGFrame`;
 *   4. serializes the scene as a compact TSV (dirty/animated/connected
 *      attributes only when `dirtyAttributesOnly` is set);
 *   5. restores playhead and comp.
 *
 * The `_mg` helper runtime is preloaded by Stallion at startup, so callers
 * send only compact commands — never the helper library itself. If the
 * preload is unavailable (isolated script contexts), the runtime is defined
 * from the vendored source inside the generated script; the wire payload is
 * the same size either way.
 */

/** The `type` value on POST /post that dispatches to the batch-step handler. */
export const BATCH_STEP_TYPE = 'batch-step'

/** Hard caps so one call cannot freeze Cavalry's UI thread (see Introspect.ts). */
export const BATCH_STEP_MAX_FRAMES = 64
export const BATCH_STEP_MAX_LAYERS = 200
export const BATCH_STEP_MAX_SCRIPT_CHARS = 512_000
export const BATCH_STEP_DEFAULT_SCALE = 100

export interface BatchStepJob {
	seq: unknown
	compId: string
	/** JS body executed before the frames are sampled. */
	script: string
	/** Declarative `_mg` manifest applied before the frames are sampled. */
	dslManifest: Record<string, unknown> | null
	frames: number[]
	restoreFrame: number | null
	queryLayers: string[]
	renderFrames: boolean
	renderOutputDir: string
	dirtyAttributesOnly: boolean
	scale: number
}

export interface BatchStepError {
	code: string
	error: string
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	const n = Number(value)
	if (!Number.isFinite(n)) return fallback
	return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Normalize a caller-supplied batch-step request. Unlike snapshot-batch, an
 * empty `sampleFrames` is legal — a caller may only want the script applied
 * plus the compact DOM, with no per-frame sampling at all.
 */
export function normalizeBatchStepJob(parsed: Record<string, unknown>): { job: BatchStepJob } | { error: BatchStepError } {
	const rawScript = typeof parsed.script === 'string' ? parsed.script : ''
	if (rawScript.length > BATCH_STEP_MAX_SCRIPT_CHARS) {
		return {
			error: {
				code: 'STALLION_BAD_REQUEST',
				error: `batch-step script exceeds ${BATCH_STEP_MAX_SCRIPT_CHARS} characters.`,
			},
		}
	}
	const rawManifest = parsed.dslManifest
	if (rawManifest !== undefined && rawManifest !== null && (typeof rawManifest !== 'object' || Array.isArray(rawManifest))) {
		return {
			error: {
				code: 'STALLION_BAD_REQUEST',
				error: 'batch-step dslManifest must be a JSON object (see _mg manifest schema).',
			},
		}
	}
	if (!rawScript && rawManifest == null) {
		return {
			error: {
				code: 'STALLION_BAD_REQUEST',
				error: 'batch-step requires `script` (JS body) or `dslManifest` (object) — or both.',
			},
		}
	}
	const rawFrames = Array.isArray(parsed.sampleFrames) ? parsed.sampleFrames : []
	const seen = new Set<number>()
	const frames: number[] = []
	for (const value of rawFrames) {
		const frame = Math.round(Number(value))
		if (!Number.isFinite(frame) || Math.abs(frame) > 1e9 || seen.has(frame)) continue
		seen.add(frame)
		frames.push(frame)
		if (frames.length >= BATCH_STEP_MAX_FRAMES) break
	}
	const queryLayers = Array.isArray(parsed.queryLayers)
		? (parsed.queryLayers as unknown[])
				.map((id) => (typeof id === 'string' ? id.trim() : ''))
				.filter(Boolean)
				.slice(0, BATCH_STEP_MAX_LAYERS)
		: []
	const scale = Number(parsed.scale)
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			script: rawScript,
			dslManifest: (rawManifest as Record<string, unknown> | null) ?? null,
			frames,
			restoreFrame: null,
			queryLayers,
			renderFrames: parsed.renderFrames === true,
			renderOutputDir:
				typeof parsed.renderOutputDir === 'string' ? parsed.renderOutputDir.trim().replace(/\\/g, '/') : '',
			dirtyAttributesOnly: parsed.dirtyAttributesOnly !== false,
			scale:
				Number.isFinite(scale) && scale > 0
					? clampInt(scale, BATCH_STEP_DEFAULT_SCALE, 1, 400)
					: BATCH_STEP_DEFAULT_SCALE,
		},
	}
}

/**
 * The batch-step runtime, as source for `api.exec`.
 *
 * Runs as a plain (non-atomic-marker) script so the wrapper opens the single
 * Undo group and captures created-layer telemetry around the whole batch —
 * the manifest may create layers and the frames must be sampled after the
 * group closes so bounding boxes are post-undo truth. The result is assigned
 * to `__result`, exactly like `renderFramesScript`.
 *
 * `mgRuntimeSource` / `mgManifestRuntime` are the vendored `_mg` runtime and
 * the `__mgApplyManifest` interpreter (see mgRuntime.ts). They are embedded
 * behind a preload check: when the startup preload landed in this context
 * (`globalThis._mg`) neither string is evaluated, and the wire payload that
 * carries this script is unaffected — the strings live in the installed
 * Stallion bundle, not in the request.
 */
export function batchStepScript(job: BatchStepJob, mgRuntimeSource: string, mgManifestRuntime: string): string {
	// The script body is inlined as code below, so it is excluded from the JSON
	// job blob — sending it twice would double the payload for no benefit.
	const jobJson = JSON.stringify({ ...job, script: '' })
	return `var __bs = ${jobJson};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __global = typeof globalThis !== 'undefined' ? globalThis : this;
var __bsStart = Date.now();

// _mg/_rb + the manifest interpreter. The startup preload defines
// globalThis._mg in this context; if that never happened (isolated script
// contexts) the vendored source is evaluated here instead. Either way the
// helpers are reachable as __mgEnv.mg / __mgEnv.applyManifest, and user code
// receives them as parameters — no global write is required for this run.
var __mgEnv = (function () {
  var pre = null;
  try {
    if (__global._mg && typeof __global._mg.shape === 'function') {
      pre = { mg: __global._mg, rb: __global._rb || null };
    }
  } catch (e) { pre = null; }
  if (pre) {
    ${mgManifestRuntime}
    return { mg: pre.mg, rb: pre.rb, applyManifest: __mgApplyManifest };
  }
  ${mgRuntimeSource}
  ${mgManifestRuntime}
  try { __global._mg = _mg; __global._rb = _rb; } catch (e) {}
  return { mg: _mg, rb: _rb, applyManifest: __mgApplyManifest };
})();

var __scriptResult = null;
var __scriptError = null;
var __manifestResult = null;
var __userResult;
try {
  if (__bs.dslManifest) {
    __manifestResult = __mgEnv.applyManifest(__bs.dslManifest);
  }
} catch (e0) {
  __scriptError = 'dslManifest: ' + String(e0 && e0.message ? e0.message : e0);
}
if (!__scriptError && ${job.script ? 'true' : 'false'}) {
  try {
    __userResult = (function (_mg, _rb) {
      ${job.script}
    })(__mgEnv.mg, __mgEnv.rb);
  } catch (e1) {
    __scriptError = 'script: ' + String(e1 && e1.message ? e1.message : e1);
  }
}
if (typeof __userResult === 'undefined' && __manifestResult !== null) __scriptResult = __manifestResult;
else if (typeof __userResult !== 'undefined') __scriptResult = __userResult;

// TSV helpers. One line per visible layer:
//   id\\ttype\\tparent\\tname\\tx,y,w,h\\tanimAttrs\\tconnections
// Cell values escape tabs/newlines so the sheet stays line-per-layer.
var __tsvCell = function (value) {
  return String(value == null ? '' : value).replace(/[\\t\\n\\r]+/g, ' ');
};
var __tsvHeader = 'id\\ttype\\tparent\\tname\\tx,y,w,h\\tanimAttrs\\tconnections';
var __tsvRows = [];

var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __bs.compId || __prevComp;
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__bs.compId && __bs.compId !== __prevComp) { __read(function () { api.setActiveComp(__bs.compId); }); }
if (!__compId) {
  __result = {
    ok: false, kind: 'batch-step', seq: __bs.seq,
    error: 'No active comp to step through.', code: 'STALLION_NO_ACTIVE_COMP',
    executionTimeMs: Date.now() - __bsStart,
    frames: {}, compactDomTsv: __tsvHeader
  };
} else {
var __allLayers = __read(function () { return api.getCompLayers(false); }) || [];
var __topLayers = __read(function () { return api.getCompLayers(true); }) || [];
var __topSet = {};
for (var t0 = 0; t0 < __topLayers.length; t0++) __topSet[__topLayers[t0]] = true;
var __index = {};
for (var i0 = 0; i0 < __allLayers.length; i0++) __index[__allLayers[i0]] = i0;
var __ids = __bs.queryLayers && __bs.queryLayers.length ? __bs.queryLayers : __allLayers.slice(0, 200);

var __frames = {};
var __renderErrors = [];
var __renderDir = __bs.renderOutputDir || (__read(function () { return api.getHomeFolder(); }) + '/.stallion/batch-step');
if (__bs.renderFrames) {
  var __folder = __read(function () { return api.getFolderFromPath(__renderDir); });
  if (__folder && typeof api.makeFolder === 'function') __read(function () { return api.makeFolder(__folder); });
}

for (var f = 0; f < __bs.frames.length; f++) {
  var __frame = __bs.frames[f];
  __read(function () { api.setFrame(__frame); });
  var __geometries = [];
  for (var l = 0; l < __ids.length; l++) {
    var __id = __ids[l];
    var __type = __read(function () { return api.getLayerType(__id); });
    var __bb = __read(function () { return api.getBoundingBox(__id, true); });
    if (!__bb) continue;
    var __bx = __num(__bb.x, 0), __by = __num(__bb.y, 0);
    var __bw = __num(__bb.width, 0), __bh = __num(__bb.height, 0);
    var __geo = {
      layerId: String(__id),
      name: String(__read(function () { return api.getNiceName(__id); }) || __id),
      type: String(__type || ''),
      bbox: { x: __bx, y: __by, width: __bw, height: __bh, cx: __bx + __bw / 2, cy: __by + __bh / 2 },
      rotation: __num(__read(function () { return api.get(__id, 'rotation'); }), 0),
      opacity: __num(__read(function () { return api.get(__id, 'opacity'); }), 100)
    };
    __geometries.push(__geo);
    if (__bs.dirtyAttributesOnly) {
      var __dirty = [];
      var __animated = __read(function () { return api.getAnimatedAttributes(__id); }) || [];
      for (var a0 = 0; a0 < __animated.length && __dirty.length < 16; a0++) __dirty.push(__animated[a0]);
      var __connectedAttrs = __read(function () { return api.getInConnectedAttributes(__id); }) || [];
      for (var a1 = 0; a1 < __connectedAttrs.length && __dirty.length < 24; a1++) {
        if (__dirty.indexOf(__connectedAttrs[a1]) < 0) __dirty.push(__connectedAttrs[a1]);
      }
      var __attrCells = [];
      for (var a2 = 0; a2 < __dirty.length; a2++) {
        var __val = __read(function () { return api.get(__id, __dirty[a2]); });
        if (__val === null || __val === undefined) continue;
        var __text = Array.isArray(__val) ? __val.join(',') : String(__val);
        __attrCells.push(__dirty[a2] + '=' + __text);
      }
      var __conns = [];
      for (var a3 = 0; a3 < __dirty.length && __conns.length < 8; a3++) {
        var __src = __read(function () { return api.getInConnection(__id, __dirty[a3]); });
        if (__src === null || __src === undefined || __src === '') continue;
        __conns.push(__dirty[a3] + '<-' + String(__src));
      }
      __tsvRows.push([
        String(__id), __tsvCell(__type), __tsvCell(__read(function () { var p = api.getParent(__id); return p || ''; })),
        __tsvCell(__geo.name),
        [Math.round(__bx * 100) / 100, Math.round(__by * 100) / 100, Math.round(__bw * 100) / 100, Math.round(__bh * 100) / 100].join(','),
        __attrCells.join(';'),
        __conns.join(';')
      ].join('\\t'));
    }
  }
  var __entry = { geometries: __geometries };
  if (__bs.renderFrames) {
    var __stem = __renderDir + '/frame_' + __frame;
    try {
      api.renderPNGFrame(__stem, __bs.scale);
      __entry.renderedPngPath = __stem + '.png';
    } catch (e2) {
      __entry.renderError = String(e2 && e2.message ? e2.message : e2);
      __renderErrors.push({ frame: __frame, error: __entry.renderError });
    }
  }
  __frames[String(__frame)] = __entry;
}

if (__bs.frames.length) { __read(function () { api.setFrame(__prevFrame); }); }
if (__bs.compId && __prevComp && __bs.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }

// Non-dirty mode still emits the full (bounded) layer list once, at the last
// sampled frame — the TSV is a scene sheet, not a per-frame log.
if (!__bs.dirtyAttributesOnly && __tsvRows.length === 0) {
  __read(function () { if (__bs.frames.length) api.setFrame(__bs.frames[__bs.frames.length - 1]); });
  for (var l2 = 0; l2 < __ids.length && __tsvRows.length < 200; l2++) {
    (function (__id) {
      var __type = __read(function () { return api.getLayerType(__id); });
      var __bb = __read(function () { return api.getBoundingBox(__id, true); });
      if (!__bb) return;
      var __attrs = __read(function () { return api.getAnimatedAttributes(__id); }) || [];
      var __attrCells = [];
      for (var b0 = 0; b0 < __attrs.length && __attrCells.length < 16; b0++) {
        var __val = __read(function () { return api.get(__id, __attrs[b0]); });
        if (__val === null || __val === undefined) continue;
        __attrCells.push(__attrs[b0] + '=' + (Array.isArray(__val) ? __val.join(',') : String(__val)));
      }
      __tsvRows.push([
        String(__id), __tsvCell(__type), __tsvCell(__read(function () { var p = api.getParent(__id); return p || ''; })),
        __tsvCell(__read(function () { return api.getNiceName(__id); }) || __id),
        [__num(__bb.x, 0), __num(__bb.y, 0), __num(__bb.width, 0), __num(__bb.height, 0)].map(function (n) { return Math.round(n * 100) / 100; }).join(','),
        __attrCells.join(';'), ''
      ].join('\\t'));
    })(__ids[l2]);
  }
  if (__bs.frames.length) { __read(function () { api.setFrame(__prevFrame); }); }
}

var __out = {
  ok: __scriptError === null,
  kind: 'batch-step',
  seq: __bs.seq,
  compId: String(__compId),
  executionTimeMs: Date.now() - __bsStart,
  scriptResult: __scriptResult,
  manifestResult: __manifestResult,
  frames: __frames,
  compactDomTsv: __tsvRows.length ? (__tsvHeader + '\\n' + __tsvRows.join('\\n')) : __tsvHeader,
  sampledFrames: __bs.frames.length,
  rendered: __bs.renderFrames ? (__bs.frames.length - __renderErrors.length) : 0,
  restoredFrame: __prevFrame
};
if (__scriptError) { __out.error = __scriptError; __out.code = 'STALLION_SCRIPT_FAILED'; }
if (__renderErrors.length) __out.renderErrors = __renderErrors;
__result = __out;
}`
}
