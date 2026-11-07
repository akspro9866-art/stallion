/**
 * Scene-graph introspection and frame snapshot loopback.
 *
 * ## Why these are message types and not URL routes
 *
 * Cavalry's `api.WebServer` is not an HTTP framework. It exposes exactly two
 * endpoints — `GET /get` and `POST /post` — one single response slot
 * (`setResultForGet`, text/plain only) and one post queue (`getNextPost`). There is
 * no router, no per-path callback and no binary response channel, so a literal
 * `GET /state` cannot be served from inside Cavalry at all.
 *
 * The bridge therefore multiplexes over the one queue it has: a POST /post payload
 * whose `type` is `state`, `layers` or `snapshot` is dispatched to a dedicated
 * handler, and the answer comes back on `GET /get` carrying the caller's `seq` and a
 * `kind` discriminator. That is exactly how `render-frames` already works, so it
 * preserves the documented protocol rather than inventing a second one, and legacy
 * clients that only ever send `type: "script"` are untouched.
 *
 * The Node mock bridge (`src/mock/server.ts`) *does* have a real router, so it also
 * serves genuine `GET /state`, `GET /layers`, `GET /frame` and `POST /snapshot`
 * paths. Automation and tests can use the path-shaped API; a live Cavalry uses the
 * `type`-shaped one. Both return byte-identical envelopes.
 *
 * ## Main-thread guardrails
 *
 * `api.exec` runs to completion on Cavalry's UI thread and cannot be interrupted or
 * time-sliced from the outside. The only honest guard is to bound the work *per
 * call*, so this module enforces:
 *
 *   - `limit` / `offset` — pagination over the layer list, default 200 layers;
 *   - `attrs` — an explicit attribute allowlist instead of walking everything;
 *   - `budgetMs` — a wall-clock ceiling. When it expires the walk stops cleanly and
 *     reports `truncated: true` with `nextOffset`, so the caller asks for the next
 *     slice on the following tick instead of one long freeze.
 *
 * A truncated response is `ok: true`. It is a partial success with a cursor, not an
 * error — the distinction matters because "I stopped to keep you interactive" and
 * "I failed" need different handling upstream.
 */

export const STATE_TYPE = 'state'
export const LAYERS_TYPE = 'layers'
export const SNAPSHOT_TYPE = 'snapshot'
export const SNAPSHOT_BATCH_TYPE = 'snapshot-batch'

/**
 * Layer types that deform or distribute another layer's geometry. Used to
 * classify a layer's children without a second scene walk, so a caller can see
 * the active procedural rig (subMesh, align, duplicator, stagger, noise…) at
 * the frame it measured rather than inferring it from connections alone.
 */
export const DEFORMER_TYPES = [
	'subMesh',
	'align',
	'duplicator',
	'stagger',
	'falloff',
	'noise',
	'noiseDeformer',
	'oscillator',
	'valueBehavior',
	'javascriptDeformer',
	'round',
	'offsetPath',
	'trimPath',
] as const

/** Defaults for one readback slice. Sized so a slice stays well under a frame. */
export const READBACK_DEFAULT_LIMIT = 200
export const READBACK_MAX_LIMIT = 1_000
export const READBACK_DEFAULT_BUDGET_MS = 120
export const READBACK_MAX_ATTRS = 40

/**
 * Attributes read when a caller asks for values but names none. These exist on
 * essentially every layer type, so the default walk cannot fail on a shape it did
 * not expect; anything unusual has to be requested by name.
 */
export const DEFAULT_ATTRS = [
	'position.x',
	'position.y',
	'scale.x',
	'scale.y',
	'rotation',
	'opacity',
] as const

/**
 * Deterministic error codes. A caller can branch on `code` without string-matching
 * prose, which is why the envelope carries both.
 */
export const ERROR_CODES = {
	BAD_REQUEST: 'STALLION_BAD_REQUEST',
	MISSING_SEQ: 'STALLION_MISSING_SEQ',
	EXEC_FAILED: 'STALLION_EXEC_FAILED',
	NO_COMP: 'STALLION_NO_ACTIVE_COMP',
	NO_FRAME: 'STALLION_NO_FRAME',
	BAD_LAYER: 'STALLION_UNKNOWN_LAYER',
	UNKNOWN_SNAPSHOT: 'STALLION_UNKNOWN_SNAPSHOT',
	RENDER_FAILED: 'STALLION_RENDER_FAILED',
	UNAUTHORISED: 'STALLION_UNAUTHORISED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export interface ErrorEnvelope extends Record<string, unknown> {
	ok: false
	kind: string
	seq?: unknown
	error: string
	code: ErrorCode
	mgCall?: string
	layerId?: string
	attrPath?: string
	stack?: string
}

/**
 * The single shape every failure in the bridge takes.
 *
 * `mgCall` names the `_mg.*` helper that produced the payload when the caller
 * supplied one, `layerId` and `attrPath` localise a bad read, and `stack` is only
 * present when the bridge actually caught a throw. Optional keys are omitted rather
 * than set to null so a diff of two envelopes stays readable.
 */
export function errorEnvelope(
	kind: string,
	code: ErrorCode,
	error: string,
	extras: { seq?: unknown; mgCall?: string; layerId?: string; attrPath?: string; stack?: string } = {},
): ErrorEnvelope {
	const envelope: Record<string, unknown> = { ok: false, kind, error, code }
	if (extras.seq !== undefined) envelope.seq = extras.seq
	if (extras.mgCall) envelope.mgCall = extras.mgCall
	if (extras.layerId) envelope.layerId = extras.layerId
	if (extras.attrPath) envelope.attrPath = extras.attrPath
	if (extras.stack) envelope.stack = String(extras.stack).slice(0, 2_000)
	return envelope as unknown as ErrorEnvelope
}

export interface ReadbackJob {
	kind: 'state' | 'layers'
	seq: unknown
	compId: string
	frame: number | null
	/** Always emitted: the playhead is moved to read evaluated values, then restored. */
	restoreFrame: number | null
	offset: number
	limit: number
	attrs: string[]
	includeAttributes: boolean
	budgetMs: number
}

/**
 * Snapshot job: render one frame to disk and report how to verify what came back.
 * `outDir` is a **scene URI** — forward slashes — because it crosses the JSON
 * boundary into the Cavalry host.
 */
export interface SnapshotJob {
	seq: unknown
	compId: string
	frame: number
	restoreFrame: number | null
	scale: number
	outDir: string
	fileName: string
}

/**
 * Batch snapshot job: render several critical frames in one `api.exec` call and
 * return the per-frame file plus the evaluated layer boxes at that same frame.
 *
 * `layerIds` is optional; an empty list means every top-level layer. `attrs`
 * adds evaluated values to each layer entry, which lets a convergence loop read
 * a transform and its rendered pixels from one round trip.
 */
export interface SnapshotBatchJob {
	seq: unknown
	compId: string
	frames: number[]
	restoreFrame: number | null
	scale: number
	outDir: string
	fileName: string
	layerIds: string[]
	attrs: string[]
	includeHidden: boolean
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	const n = Number(value)
	if (!Number.isFinite(n)) return fallback
	return Math.min(max, Math.max(min, Math.round(n)))
}

/** Normalise a caller-supplied slice request into something safe to execute. */
export function normalizeReadbackJob(
	kind: 'state' | 'layers',
	parsed: Record<string, unknown>,
): ReadbackJob {
	const requested = Array.isArray(parsed.attrs) ? (parsed.attrs as unknown[]) : []
	const attrs = requested
		.map((a) => (typeof a === 'string' ? a.trim() : ''))
		.filter(Boolean)
		.slice(0, READBACK_MAX_ATTRS)
	return {
		kind,
		seq: parsed.seq,
		compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
		frame: Number.isFinite(Number(parsed.frame)) ? clampInt(parsed.frame, 0, -1e9, 1e9) : null,
		restoreFrame: null,
		offset: clampInt(parsed.offset, 0, 0, 1e9),
		limit: clampInt(parsed.limit, READBACK_DEFAULT_LIMIT, 1, READBACK_MAX_LIMIT),
		attrs: attrs.length ? attrs : [...DEFAULT_ATTRS],
		includeAttributes: parsed.attributes === true,
		budgetMs: clampInt(parsed.budgetMs, READBACK_DEFAULT_BUDGET_MS, 5, 5_000),
	}
}

/** One filesystem-safe stem; the bridge uses the same rule for every kind. */
export function safeFileName(value: unknown, fallback: string): string {
	const raw = typeof value === 'string' ? value.trim() : ''
	return (raw || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

export function normalizeSnapshotJob(
	parsed: Record<string, unknown>,
): { job: SnapshotJob } | { error: string; code: ErrorCode } {
	const frame = Number(parsed.frame ?? parsed.t)
	if (!Number.isFinite(frame)) {
		return { error: 'snapshot requires a numeric `frame` (or `t`).', code: ERROR_CODES.NO_FRAME }
	}
	const scale = Number(parsed.scale ?? parsed.resolutionScale)
	const fileName = safeFileName(parsed.fileName, `snapshot-${String(Math.round(frame)).padStart(6, '0')}`)
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			frame: clampInt(frame, 0, -1e9, 1e9),
			restoreFrame: null,
			scale: Number.isFinite(scale) && scale > 0 ? clampInt(scale, 100, 1, 400) : 100,
			// Scene URI form: forward slashes, always, so the same value is produced
			// from a Windows and a Linux caller.
			outDir: typeof parsed.outDir === 'string' ? parsed.outDir.trim().replace(/\\/g, '/') : '',
			fileName,
		},
	}
}

/**
 * Normalise a batch snapshot request. Frames are deduped and sorted so two
 * callers asking for the same set produce the same files in the same order; the
 * cap exists because every frame is a synchronous PNG render on Cavalry's UI
 * thread. Layer ids and attrs are bounded like the readback path.
 */
export function normalizeSnapshotBatchJob(
	parsed: Record<string, unknown>,
): { job: SnapshotBatchJob } | { error: string; code: ErrorCode } {
	const rawFrames = Array.isArray(parsed.frames) ? parsed.frames : []
	const seen = new Set<number>()
	const frames: number[] = []
	for (const value of rawFrames) {
		const frame = Math.round(Number(value))
		if (!Number.isFinite(frame) || Math.abs(frame) > 1e9 || seen.has(frame)) continue
		seen.add(frame)
		frames.push(frame)
		if (frames.length >= 64) break
	}
	if (!frames.length) {
		return { error: 'snapshot-batch requires a non-empty numeric `frames` array (1..64).', code: ERROR_CODES.NO_FRAME }
	}
	frames.sort((a, b) => a - b)
	const scale = Number(parsed.scale ?? parsed.resolutionScale)
	const layerIds = Array.isArray(parsed.layerIds)
		? (parsed.layerIds as unknown[]).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean).slice(0, 200)
		: []
	const attrs = Array.isArray(parsed.attrs)
		? (parsed.attrs as unknown[]).map((a) => (typeof a === 'string' ? a.trim() : '')).filter(Boolean).slice(0, 16)
		: []
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			frames,
			restoreFrame: null,
			scale: Number.isFinite(scale) && scale > 0 ? clampInt(scale, 100, 1, 400) : 100,
			outDir: typeof parsed.outDir === 'string' ? parsed.outDir.trim().replace(/\\/g, '/') : '',
			fileName: safeFileName(parsed.fileName, 'snapshot-batch'),
			layerIds,
			attrs,
			includeHidden: parsed.includeHidden === true,
		},
	}
}

/**
 * The readback runtime, as source for `api.exec`.
 *
 * It runs inside Cavalry's scripting host: no Node, no `fs`, no `crypto`, no
 * `import`. Everything is a defensive read because a layer whose type does not
 * expose an attribute must not abort the whole walk — that field is simply `null`
 * and the reason is recorded in `unreadable`.
 *
 * Deterministic IDs:
 *   - `ref`        — `<layerType>#<index>`, Cavalry's own canonical addressing. It
 *                    survives a save/reload, which a numeric node id does not.
 *   - `semanticId` — a slug of `<comp>_<name>` plus the index as a tiebreaker, so
 *                    `beat_02_card_spring` style IDs are reproducible from the scene
 *                    alone and are what an `_mg.patch` refinement pass keys against.
 *
 * The `/* cavalry-mcp:atomic *\/` prefix is load-bearing, not cosmetic. Both the real
 * wrapper (`Callbacks.#wrapped`) and the mock (`executeOnMock`) treat an atomic script
 * as an *expression* and skip the `startUndoGroup` / telemetry scaffolding. A readback
 * changes nothing, so it must not open an undo step — and it has to return its payload
 * as the expression value rather than assigning `__result`. Because of that the emitted
 * source deliberately ends in `})()` with no semicolon: `var __returned = (` + source +
 * `)` has to parse, and a trailing `;` inside those parens is a syntax error.
 */
export function readbackScript(job: ReadbackJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __rb = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
// getBoundingBox(id, true) is documented as {x, y, width, height, centre, left, right,
// top}. Reading width/height rather than w/h is what the shipped receipt code already
// does against a live 2.8 host; the array and w/h fallbacks stay so one odd layer type
// cannot blank out a box.
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
// A measured box is only useful to a calibration loop if the pivot and the
// centre are explicit. pivotX/Y are the pivot's offset *inside* the box, so a
// caller never has to guess whether the box or the pivot is top-left based.
var __pivotInBox = function (box, pivot) {
	if (!box || !pivot) return box;
	return {
		x: box.x, y: box.y, width: box.width, height: box.height,
		pivotX: __num(pivot.x, 0) - box.x,
		pivotY: __num(pivot.y, 0) - box.y,
		centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 }
	};
};
var __started = Date.now();
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __rb.compId || __prevComp;
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__rb.compId && __rb.compId !== __prevComp) { __read(function () { api.setActiveComp(__rb.compId); }); }
// An empty scene and a scene with no comp open are different states, and collapsing
// them into total:0 forces the caller to guess. Say which one it is.
if (!__compId) {
	return { ok: false, kind: __rb.kind, seq: __rb.seq, error: 'No active comp to read back.', code: 'STALLION_NO_ACTIVE_COMP' };
}

var __slug = function (text) {
	return String(text == null ? '' : text)
		.replace(/[^A-Za-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase()
		.slice(0, 48);
};

var __ids = __read(function () { return api.getCompLayers(false); }) || [];
var __top = __read(function () { return api.getCompLayers(true); }) || [];
var __topSet = {};
for (var t = 0; t < __top.length; t++) __topSet[__top[t]] = true;

// One parent walk builds the child map and the deformer classification without
// a getChildren call per layer (not every 2.8 build exposes it, and the walk is
// already bounded by the readback limit).
var __deformerTypes = ${JSON.stringify(DEFORMER_TYPES)};
var __deformerSet = {};
for (var d0 = 0; d0 < __deformerTypes.length; d0++) __deformerSet[__deformerTypes[d0]] = true;
var __deformerType = function (type) {
	var raw = String(type == null ? '' : type);
	if (__deformerSet[raw]) return true;
	var lower = raw.toLowerCase();
	for (var d1 = 0; d1 < __deformerTypes.length; d1++) {
		if (__deformerTypes[d1].toLowerCase() === lower) return true;
	}
	return lower.indexOf('deformer') >= 0;
};
var __children = {};
for (var c0 = 0; c0 < __ids.length; c0++) {
	var __childParent = __read(function () { return api.getParent(__ids[c0]); });
	if (__childParent) {
		if (!__children[__childParent]) __children[__childParent] = [];
		__children[__childParent].push(__ids[c0]);
	}
}

// Depth from the comp root, so a hierarchy can be rebuilt without a second pass.
var __depth = {};
var depthOf = function (id) {
	if (__depth[id] !== undefined) return __depth[id];
	var guard = 0, d = 0, cur = id;
	while (guard++ < 32) {
		var p = __read(function () { return api.getParent(cur); });
		if (!p || p === cur) break;
		cur = p; d++;
	}
	__depth[id] = d;
	return d;
};

// Step the playhead once, then read every layer at that instant. Values are the
// evaluated ones — a connected or animated attribute reports what is on screen at
// __rb.frame, not its static default.
var __frame = __rb.frame === null ? __prevFrame : __rb.frame;
if (__frame !== __prevFrame) __read(function () { api.setFrame(__frame); });

var __names = {};
var __total = __ids.length;
var __out = [];
var __truncated = false;
var __nextOffset = -1;
var __index = {};
for (var i = 0; i < __total; i++) __index[__ids[i]] = i;

for (var k = __rb.offset; k < __total; k++) {
	if (Date.now() - __started > __rb.budgetMs) { __truncated = true; __nextOffset = k; break; }
	if (__out.length >= __rb.limit) { __truncated = true; __nextOffset = k; break; }
	var id = __ids[k];
	var type = __read(function () { return api.getLayerType(id); });
	var name = __read(function () { return api.getNiceName(id); });
	__names[id] = name;
	var parent = __read(function () { return api.getParent(id); });
	if (parent && __names[parent] === undefined) {
		__names[parent] = __read(function () { return api.getNiceName(parent); });
	}
	var chain = [];
	var cur = id, guard = 0;
	while (guard++ < 16 && cur) { chain.unshift(__slug(__names[cur] || cur) + '#' + (__index[cur] === undefined ? '?' : __index[cur])); var up = __read(function () { return api.getParent(cur); }); if (!up || up === cur) break; cur = up; }
	// semanticId is index-qualified so it is unique and reproducible from the scene
	// alone. Dropping the suffix would collide as soon as two layers share a label, and
	// resolving collisions by scanning every preceding layer is O(n^2) across the comp —
	// on Cavalry's single thread that is precisely the freeze the budget exists to
	// prevent. semanticSlug carries the bare name for callers that want to group.
	var base = __slug(name || type);
	var semantic = (base || 'layer') + '_' + k;

	var entry = {
		id: id,
		ref: type + '#' + k,
		semanticId: semantic,
		semanticSlug: base,
		type: type,
		name: name,
		path: chain,
		depth: depthOf(id),
		topLevel: __topSet[id] === true,
		parent: parent || null,
		parentName: parent ? (__names[parent] || null) : null,
		hidden: false,
		visible: true,
		inFrame: __read(function () { return api.getInFrame(id); }),
		outFrame: __read(function () { return api.getOutFrame(id); }),
		boundingBox: null,
		worldBoundingBox: null,
		compBoundingBox: null,
		pivot: null,
		deformers: [],
		childCount: __children[id] ? __children[id].length : 0,
		attrs: {},
		connected: [],
		unreadable: []
	};
	var hidden = __read(function () { return api.get(id, 'hidden'); });
	entry.hidden = hidden === true || hidden === 1 || hidden === 'true';
	entry.visible = !entry.hidden;
	if (entry.visible) {
		// A layer outside its in/out range is not visible at this frame even when
		// the hidden flag is false. Report that as visibility, not as a box of 0.
		var __if = entry.inFrame, __of = entry.outFrame;
		if (typeof __if === 'number' && typeof __of === 'number' && (__frame < __if || __frame > __of)) entry.visible = false;
	}
	var pv = __read(function () { return api.getPivotPosition(id); });
	if (pv) entry.pivot = { x: __num(Array.isArray(pv) ? pv[0] : pv.x, 0), y: __num(Array.isArray(pv) ? pv[1] : pv.y, 0) };
	var worldBox = __pivotInBox(__box(__read(function () { return api.getBoundingBox(id, true); })), entry.pivot);
	var compBox = __pivotInBox(__box(__read(function () { return api.getBoundingBox(id, false); })), entry.pivot);
	if (worldBox) entry.worldBoundingBox = worldBox;
	if (compBox) entry.compBoundingBox = compBox;
	// The legacy boundingBox field keeps its historical meaning (world space) so
	// existing callers do not change behaviour; the two explicit fields are the
	// new contract for calibration and perceptual diffing.
	if (worldBox) entry.boundingBox = worldBox;
	else if (compBox) entry.boundingBox = compBox;
	var kids = __children[id] || [];
	for (var kd = 0; kd < kids.length && entry.deformers.length < 16; kd++) {
		var kidType = __read(function () { return api.getLayerType(kids[kd]); });
		if (!__deformerType(kidType)) continue;
		entry.deformers.push({
			id: kids[kd],
			type: kidType,
			name: __read(function () { return api.getNiceName(kids[kd]); }),
			visible: __read(function () { var h = api.get(kids[kd], 'hidden'); return !(h === true || h === 1 || h === 'true'); }) !== false
		});
	}

	var want = __rb.attrs;
	if (__rb.includeAttributes) {
		var declared = __read(function () { return api.getAttributes(id); });
		if (Array.isArray(declared) && declared.length) {
			want = declared.slice(0, 40);
			entry.attributeNames = declared;
		}
	}
	for (var a = 0; a < want.length; a++) {
		var path = want[a];
		var value = __read(function () { return api.get(id, path); });
		// Driven? An attribute fed by a behaviour node or another layer reports the
		// upstream ref here, so a caller can tell a procedural rig from a baked value
		// without a second round trip. This is what refclone keys its tier decisions on.
		var drivenBy = __read(function () { return api.getInConnection(id, path); });
		if (drivenBy) entry.connected.push({ attrPath: path, from: String(drivenBy) });
		if (value === null || value === undefined) { entry.unreadable.push(path); continue; }
		if (Array.isArray(value)) entry.attrs[path] = value.map(function (v) { return __num(v, v); });
		else if (typeof value === 'object') entry.attrs[path] = { x: __num(value.x, value.x), y: __num(value.y, value.y) };
		else entry.attrs[path] = typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ? value : String(value);
	}
	var outs = [];
	for (var o = 0; o < want.length && outs.length < 16; o++) {
		var list = __read(function () { return api.getOutConnections(id, want[o]); });
		if (Array.isArray(list) && list.length) outs.push({ attrPath: want[o], to: list.map(String) });
	}
	if (outs.length) entry.outConnections = outs;
	__out.push(entry);
}

if (__rb.frame !== null && __frame !== __prevFrame) { __read(function () { api.setFrame(__prevFrame); }); }
if (__rb.compId && __prevComp && __rb.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }

return {
	ok: true,
	kind: __rb.kind,
	seq: __rb.seq,
	compId: __compId,
	frame: __frame,
	total: __total,
	offset: __rb.offset,
	returned: __out.length,
	truncated: __truncated,
	nextOffset: __nextOffset,
	elapsedMs: Date.now() - __started,
	layers: __out
};
})()`;
}

/**
 * Snapshot runtime: move to `frame`, render one PNG, restore the playhead and comp,
 * then report the file plus what is needed to verify it without polling the disk.
 *
 * `renderedAt` is captured immediately after the render returns, and `sizeBytes` /
 * `exists` come from the same call, so a caller can confirm the file is the one this
 * request produced rather than a stale frame from an earlier pass. Cavalry's script
 * host has no directory listing, so `contentHash` is computed by the bridge layer
 * (or the mock) after the file lands — the script reports where it is and when.
 */
export function snapshotScript(job: SnapshotJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __sn = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
var __prevComp = __read(function () { return api.getActiveComp(); });
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__sn.compId && __sn.compId !== __prevComp) { __read(function () { api.setActiveComp(__sn.compId); }); }
var __dir = __sn.outDir || (api.getHomeFolder() + '/.stallion/snapshots');
var __target = __dir + '/' + __sn.fileName;
var __ok = true, __error = null, __code = null;
if (!(__sn.compId || __prevComp)) { __ok = false; __error = 'No active comp to render.'; __code = 'STALLION_NO_ACTIVE_COMP'; }
try { if (__ok && __sn.frame !== __prevFrame) api.setFrame(__sn.frame); } catch (e) { __ok = false; __error = String(e && e.message ? e.message : e); __code = 'STALLION_RENDER_FAILED'; }
if (__ok) {
	try { api.renderPNGFrame(__target, __sn.scale); } catch (e2) { __ok = false; __error = String(e2 && e2.message ? e2.message : e2); __code = 'STALLION_RENDER_FAILED'; }
}
var __renderedAt = Date.now();
// Verify the artifact in the same call that produced it: size and existence read back
// straight after renderPNGFrame returns. Without this a caller has to poll the disk to
// learn whether the frame is real, and cannot tell this render from a stale file.
var __bytes = __ok ? __read(function () { return api.getFileSize(__target + '.png'); }) : null;
var __exists = __bytes === null ? __read(function () { return api.filePathExists(__target + '.png'); }) : __bytes > 0;
if (__ok && __bytes !== null && !(__bytes > 0)) { __ok = false; __error = 'renderPNGFrame produced a zero-byte file at ' + __target + '.png'; __code = 'STALLION_RENDER_FAILED'; }
// Deterministic frame digest. Cavalry's script host has no crypto module and cannot
// read the PNG it just wrote back as bytes, so hashing the *file* is not available
// here; what is available — and what actually answers "which frame is this" — is a
// digest of the evaluated scene at that frame. Two renders of the same comp at the
// same frame produce the same value, and any change to geometry on that frame changes
// it. Callers that need a content hash of the bytes compute it after reading the file
// over localhost, and the mock bridge fills contentHash in directly.
// Bounded to 64 layers: this is a fingerprint, not a full walk, and it must not eat
// the slice's whole budget.
var __dig = function (str) {
	var hi = 0x811c9dc5, lo = 0x1b873593;
	for (var p = 0; p < str.length; p++) {
		hi ^= str.charCodeAt(p); hi = Math.imul(hi, 0x01000193) >>> 0;
		lo ^= str.charCodeAt(str.length - 1 - p); lo = Math.imul(lo, 0x01000193) >>> 0;
	}
	return ('00000000' + hi.toString(16)).slice(-8) + ('00000000' + lo.toString(16)).slice(-8);
};
var __frameHash = null;
if (__ok) {
	var __sigIds = (__read(function () { return api.getCompLayers(true); }) || []).slice(0, 64);
	var __sig = '';
	for (var q = 0; q < __sigIds.length; q++) {
		var __sid = __sigIds[q];
		var __sbb = __box(__read(function () { return api.getBoundingBox(__sid, true); }));
		__sig += __sid + '|';
		if (__sbb) __sig += [__sbb.x, __sbb.y, __sbb.width, __sbb.height].join(',');
		__sig += ';';
	}
	__frameHash = __dig(String(__sn.frame) + '#' + String(__sn.compId || __prevComp) + '#' + __sig);
}
if (__sn.frame !== __prevFrame) { __read(function () { api.setFrame(__prevFrame); }); }
if (__sn.compId && __prevComp && __sn.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }
return {
	ok: __ok,
	kind: 'snapshot',
	seq: __sn.seq,
	compId: String(__sn.compId || __prevComp),
	frame: __sn.frame,
	file: __target + '.png',
	fileName: __sn.fileName,
	scale: __sn.scale,
	renderedAt: __renderedAt,
	renderedAtIso: new Date(__renderedAt).toISOString(),
	restoredFrame: __prevFrame,
	exists: __exists === true,
	sizeBytes: __bytes === null ? null : Number(__bytes),
	frameHash: __frameHash,
	error: __error,
	code: __code
};
})()`;
}

/**
 * Multi-frame snapshot runtime.
 *
 * Renders every requested critical frame in one `api.exec` call, verifying each
 * PNG in the same call (size + existence) and returning the evaluated layer
 * boxes at that frame. The playhead and active comp are restored exactly once,
 * after the last frame, so a six-frame convergence pass costs one host round
 * trip instead of six.
 *
 * Layer entries deliberately mirror the readback shape (`id`, `ref`, `type`,
 * `name`, `visible`, `bbox`), but the box always carries `pivotX`, `pivotY`
 * and `centre`, so Stage 5 can compute a signed position residual without a
 * second `/layers` request for the same frame.
 */
export function snapshotBatchScript(job: SnapshotBatchJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __sb = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __pad = function (n) { var s = String(n); while (s.length < 6) { s = '0' + s; } return s; };
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
var __dig = function (str) {
	var hi = 0x811c9dc5, lo = 0x1b873593;
	for (var p = 0; p < str.length; p++) {
		hi ^= str.charCodeAt(p); hi = Math.imul(hi, 0x01000193) >>> 0;
		lo ^= str.charCodeAt(str.length - 1 - p); lo = Math.imul(lo, 0x01000193) >>> 0;
	}
	return ('00000000' + hi.toString(16)).slice(-8) + ('00000000' + lo.toString(16)).slice(-8);
};
var __prevComp = __read(function () { return api.getActiveComp(); });
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__sb.compId && __sb.compId !== __prevComp) { __read(function () { api.setActiveComp(__sb.compId); }); }
var __compId = __sb.compId || __prevComp;
if (!__compId) {
	return { ok: false, kind: 'snapshot-batch', seq: __sb.seq, error: 'No active comp to render.', code: 'STALLION_NO_ACTIVE_COMP', frames: [] };
}
var __dir = __sb.outDir || (api.getHomeFolder() + '/.stallion/snapshots');
var __all = __read(function () { return api.getCompLayers(false); }) || [];
var __index = {};
for (var ai = 0; ai < __all.length; ai++) __index[__all[ai]] = ai;
var __ids = __sb.layerIds && __sb.layerIds.length ? __sb.layerIds : (__read(function () { return api.getCompLayers(false); }) || []).slice(0, 200);
var __started = Date.now();
var __frames = [];
var __errors = [];
for (var f = 0; f < __sb.frames.length; f++) {
	var __frame = __sb.frames[f];
	var __stem = __dir + '/' + __sb.fileName + '-' + __pad(__frame);
	var __file = __stem + '.png';
	var __entry = { frame: __frame, file: __file, exists: false, sizeBytes: null, renderedAt: null, frameHash: null, layers: [], error: null, code: null };
	__read(function () { api.setFrame(__frame); });
	try {
		api.renderPNGFrame(__stem, __sb.scale);
		__entry.renderedAt = Date.now();
	} catch (e) {
		__entry.error = String(e && e.message ? e.message : e);
		__entry.code = 'STALLION_RENDER_FAILED';
	}
	var __bytes = __read(function () { return api.getFileSize(__file); });
	__entry.sizeBytes = __bytes === null ? null : Number(__bytes);
	__entry.exists = __bytes === null ? __read(function () { return api.filePathExists(__file); }) === true : Number(__bytes) > 0;
	if (!__entry.error && !__entry.exists) {
		__entry.error = 'renderPNGFrame produced no readable file at ' + __file;
		__entry.code = 'STALLION_RENDER_FAILED';
	}
	var __sig = '';
	for (var l = 0; l < __ids.length; l++) {
		var __id = __ids[l];
		var __pivot = __read(function () { return api.getPivotPosition(__id); });
		var __p = __pivot ? { x: __num(Array.isArray(__pivot) ? __pivot[0] : __pivot.x, 0), y: __num(Array.isArray(__pivot) ? __pivot[1] : __pivot.y, 0) } : null;
		var __world = __box(__read(function () { return api.getBoundingBox(__id, true); }));
		var __hidden = __read(function () { return api.get(__id, 'hidden'); });
		var __visible = !(__hidden === true || __hidden === 1 || __hidden === 'true');
		if (__visible) {
			var __in = __read(function () { return api.getInFrame(__id); });
			var __out = __read(function () { return api.getOutFrame(__id); });
			if (typeof __in === 'number' && typeof __out === 'number' && (__frame < __in || __frame > __out)) __visible = false;
		}
		var __bbox = null;
		if (__world) {
			__bbox = {
				x: __world.x, y: __world.y, width: __world.width, height: __world.height,
				pivotX: __p ? __p.x - __world.x : __world.width / 2,
				pivotY: __p ? __p.y - __world.y : __world.height / 2,
				centre: { x: __world.x + __world.width / 2, y: __world.y + __world.height / 2 }
			};
		}
		var __layer = {
			id: __id,
			ref: __read(function () { return api.getLayerType(__id); }) + '#' + (__index[__id] === undefined ? '?' : __index[__id]),
			type: __read(function () { return api.getLayerType(__id); }),
			name: __read(function () { return api.getNiceName(__id); }),
			visible: __visible,
			bbox: __bbox
		};
		if (__sb.attrs && __sb.attrs.length) {
			var __attrs = {};
			for (var a = 0; a < __sb.attrs.length; a++) {
				var __v = __read(function () { return api.get(__id, __sb.attrs[a]); });
				if (__v !== undefined && __v !== null) __attrs[__sb.attrs[a]] = __v;
			}
			__layer.attrs = __attrs;
		}
		if (!__sb.includeHidden && !__visible) continue;
		__sig += __id + '|' + (__bbox ? [__bbox.x, __bbox.y, __bbox.width, __bbox.height].join(',') : '') + ';';
		__entry.layers.push(__layer);
	}
	__entry.frameHash = __dig(String(__frame) + '#' + String(__compId) + '#' + __sig);
	__frames.push(__entry);
	if (__entry.error) __errors.push({ frame: __frame, error: __entry.error, code: __entry.code });
}
if (__sb.frames.length) __read(function () { api.setFrame(__prevFrame); });
if (__sb.compId && __prevComp && __sb.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }
return {
	ok: __errors.length === 0,
	kind: 'snapshot-batch',
	seq: __sb.seq,
	compId: String(__compId),
	frames: __frames,
	errors: __errors,
	requested: __sb.frames.length,
	rendered: __frames.length - __errors.length,
	scale: __sb.scale,
	restoredFrame: __prevFrame,
	elapsedMs: Date.now() - __started
};
})()`;
}
