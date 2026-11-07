/**
 * `/batch_inspect` — single-roundtrip multi-frame readback matrix.
 *
 * ## Why this exists next to `snapshot-batch`
 *
 * `snapshot-batch` (Introspect.ts) renders a PNG per frame; Stage 4.5's local
 * solver needs the *geometry only*, several times per second, and rendering
 * pixels it never looks at dominates its latency. `batch_inspect` scrubs the
 * playhead across the requested frames, reads each target layer's world-space
 * bounding box and requested attribute values, restores the playhead and
 * returns one compact JSON matrix — zero pixels touched.
 *
 * ## Protocol position
 *
 * Exactly like every other introspection kind: Cavalry's `api.WebServer`
 * exposes only `GET /get` and `POST /post`, so the live bridge multiplexes it
 * as a `type` on POST /post and the answer comes back on GET /get carrying the
 * caller's `seq`. The Node mock bridge additionally serves the literal
 * `POST /batch_inspect` path and answers with the identical envelope.
 *
 * Envelope shape (the contract refclone's Stage 4.5 keys against):
 *
 *   {
 *     ok: true,
 *     kind: 'batch_inspect',
 *     seq, compId,
 *     compFrameRate: 60,              // null when the host will not report it
 *     compResolution: [1920, 1080],   // null when the host will not report it
 *     timeline: {
 *       "12": {
 *         "shape#3": { bbox: { x, y, w, h, cx, cy }, attrs: {…}, visible: true }
 *       }
 *     },
 *     elapsedMs, restoredFrame
 *   }
 *
 * The `w`/`h`/`cx`/`cy` short names are deliberate: this envelope is read
 * thousands of times by the local solver, and the long-form
 * `width`/`height`/`centre` fields of the other kinds are the ones that cost
 * tokens on the wire. Nothing else in the bridge emits the short form.
 *
 * ## Main-thread guardrails
 *
 * Same discipline as the other readbacks: hard caps (64 frames, 200 layers,
 * 16 attributes) so one `api.exec` cannot freeze Cavalry's UI thread, and the
 * playhead + active comp are restored exactly once, after the last frame.
 */

export const BATCH_INSPECT_TYPE = 'batch_inspect'

export const BATCH_INSPECT_MAX_FRAMES = 64
export const BATCH_INSPECT_MAX_LAYERS = 200
export const BATCH_INSPECT_MAX_ATTRS = 16

export interface BatchInspectJob {
	seq: unknown
	compId: string
	frames: number[]
	layerIds: string[]
	attrs: string[]
	includeHidden: boolean
}

export interface BatchInspectError {
	code: string
	error: string
}

/**
 * Normalize a caller-supplied batch_inspect request. Frames are deduped and
 * sorted so the same request always produces the same timeline key order; an
 * empty `frames` array is a BAD_REQUEST (the caller is asking for a matrix,
 * and an empty matrix is always a caller bug).
 */
export function normalizeBatchInspectJob(parsed: Record<string, unknown>): { job: BatchInspectJob } | { error: BatchInspectError } {
	const rawFrames = Array.isArray(parsed.frames) ? parsed.frames : []
	const seen = new Set<number>()
	const frames: number[] = []
	for (const value of rawFrames) {
		const frame = Math.round(Number(value))
		if (!Number.isFinite(frame) || Math.abs(frame) > 1e9 || seen.has(frame)) continue
		seen.add(frame)
		frames.push(frame)
		if (frames.length >= BATCH_INSPECT_MAX_FRAMES) break
	}
	if (!frames.length) {
		return {
			error: {
				code: 'STALLION_BAD_REQUEST',
				error: `batch_inspect requires a non-empty numeric \`frames\` array (1..${BATCH_INSPECT_MAX_FRAMES}).`,
			},
		}
	}
	frames.sort((a, b) => a - b)
	const layerIds = Array.isArray(parsed.layerIds)
		? (parsed.layerIds as unknown[])
				.map((id) => (typeof id === 'string' ? id.trim() : ''))
				.filter(Boolean)
				.slice(0, BATCH_INSPECT_MAX_LAYERS)
		: []
	const attrs = Array.isArray(parsed.attributes)
		? (parsed.attributes as unknown[])
				.map((a) => (typeof a === 'string' ? a.trim() : ''))
				.filter(Boolean)
				.slice(0, BATCH_INSPECT_MAX_ATTRS)
		: []
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			frames,
			layerIds,
			attrs,
			includeHidden: parsed.includeHidden === true,
		},
	}
}

/**
 * The batch_inspect runtime, as source for `api.exec`.
 *
 * Runs inside Cavalry's scripting host under the atomic marker: a readback
 * must not open an undo step, and it must return its payload as the expression
 * value (see Introspect.ts for why the source ends in `})()` with no
 * semicolon).
 */
export function batchInspectScript(job: BatchInspectJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __bi = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
var __started = Date.now();
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __bi.compId || __prevComp;
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__bi.compId && __bi.compId !== __prevComp) { __read(function () { return api.setActiveComp(__bi.compId); }); }
if (!__compId) {
	return { ok: false, kind: 'batch_inspect', seq: __bi.seq, error: 'No active comp to inspect.', code: 'STALLION_NO_ACTIVE_COMP' };
}
// Comp metadata rides the comp node itself; both spellings occur in the wild,
// so frameRate falls back to fps and a host that reports neither stays null
// rather than lying with a default.
var __compFrameRate = null;
var __fr = __read(function () { return api.get(__compId, 'frameRate'); });
if (__fr === null || __fr === undefined) __fr = __read(function () { return api.get(__compId, 'fps'); });
if (typeof __fr === 'number' && isFinite(__fr) && __fr > 0) __compFrameRate = __fr;
var __compResolution = null;
var __res = __read(function () { return api.get(__compId, 'resolution'); });
var __compW = null, __compH = null;
if (Array.isArray(__res) && __res.length >= 2) { __compW = Number(__res[0]); __compH = Number(__res[1]); }
else if (__res && typeof __res === 'object') { __compW = Number(__res.x); __compH = Number(__res.y); }
if (!(__compW > 0 && __compH > 0)) {
	__compW = __read(function () { return api.get(__compId, 'width'); });
	__compH = __read(function () { return api.get(__compId, 'height'); });
}
if (typeof __compW === 'number' && __compW > 0 && typeof __compH === 'number' && __compH > 0) {
	__compResolution = [__compW, __compH];
}
// Layer selection: the caller's list when given (ids the host does not know are
// skipped per frame and reported once), otherwise every layer in the comp.
var __all = __read(function () { return api.getCompLayers(false); }) || [];
var __index = {};
for (var ai = 0; ai < __all.length; ai++) __index[__all[ai]] = ai;
var __ids = __bi.layerIds && __bi.layerIds.length ? __bi.layerIds.slice(0, ${BATCH_INSPECT_MAX_LAYERS}) : __all.slice(0, ${BATCH_INSPECT_MAX_LAYERS});
var __unknown = [];
for (var ui = 0; ui < __ids.length; ui++) {
	if (__bi.layerIds && __bi.layerIds.length && __index[__ids[ui]] === undefined) __unknown.push(__ids[ui]);
}
var __attrs = __bi.attrs && __bi.attrs.length ? __bi.attrs : ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity'];
var __timeline = {};
var __visibleCount = 0;
for (var f = 0; f < __bi.frames.length; f++) {
	var __frame = __bi.frames[f];
	__read(function () { return api.setFrame(__frame); });
	var __frameEntry = {};
	for (var l = 0; l < __ids.length; l++) {
		var __id = __ids[l];
		var __world = __box(__read(function () { return api.getBoundingBox(__id, true); }));
		var __hidden = __read(function () { return api.get(__id, 'hidden'); });
		var __visible = !(__hidden === true || __hidden === 1 || __hidden === 'true');
		if (__visible) {
			var __in = __read(function () { return api.getInFrame(__id); });
			var __out = __read(function () { return api.getOutFrame(__id); });
			if (typeof __in === 'number' && typeof __out === 'number' && (__frame < __in || __frame > __out)) __visible = false;
		}
		var __entry = null;
		if (__world) {
			__entry = {
				bbox: {
					x: __world.x, y: __world.y,
					w: __world.width, h: __world.height,
					cx: __world.x + __world.width / 2, cy: __world.y + __world.height / 2
				},
				attrs: {},
				visible: __visible
			};
			for (var a = 0; a < __attrs.length; a++) {
				var __path = __attrs[a];
				var __v = __read(function () { return api.get(__id, __path); });
				if (__v === null || __v === undefined) continue;
				if (Array.isArray(__v)) __entry.attrs[__path] = __v.map(function (item) { return __num(item, item); });
				else if (typeof __v === 'object') __entry.attrs[__path] = { x: __num(__v.x, __v.x), y: __num(__v.y, __v.y) };
				else __entry.attrs[__path] = typeof __v === 'number' || typeof __v === 'boolean' || typeof __v === 'string' ? __v : String(__v);
			}
			if (__visible) __visibleCount++;
		}
		// A layer with no box at this frame (not yet created, deleted, or fully
		// degenerate) is omitted from the frame's map — the solver treats an
		// absent key as "no measurement", not as a box at the origin.
		if (__entry !== null) __frameEntry[__id] = __entry;
	}
	__timeline[String(__frame)] = __frameEntry;
}
if (__bi.frames.length) { __read(function () { return api.setFrame(__prevFrame); }); }
if (__bi.compId && __prevComp && __bi.compId !== __prevComp) { __read(function () { return api.setActiveComp(__prevComp); }); }
var __envelope = {
	ok: true,
	kind: 'batch_inspect',
	seq: __bi.seq,
	compId: String(__compId),
	compFrameRate: __compFrameRate,
	compResolution: __compResolution,
	frames: __bi.frames,
	timeline: __timeline,
	visibleLayerFrames: __visibleCount,
	restoredFrame: __prevFrame,
	elapsedMs: Date.now() - __started
};
if (__unknown.length) __envelope.unknownLayerIds = __unknown;
return __envelope;
})()`
}
