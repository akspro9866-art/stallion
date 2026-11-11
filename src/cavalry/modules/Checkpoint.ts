/**
 * `/checkpoint` & `/rollback` — fast scene state checkpointing.
 *
 * ## Why a new kind instead of reusing `snapshot`
 *
 * `snapshot` (Introspect.ts) is taken: it renders PNGs. This module is the
 * *state* checkpoint the refinement loop needs: serialize the managed layers'
 * attribute/keyframe/connection state under a caller-chosen `snapshotId`,
 * keep it in memory on the bridge (with a fast temp-file copy in the OS temp
 * directory), and restore it in milliseconds when a structural mutation is
 * rejected — avoiding a full composition rebuild. Renaming the existing PNG
 * kind would break every current client, so the state pair is `checkpoint` /
 * `rollback` and the mock additionally serves them as literal paths.
 *
 * ## What gets captured
 *
 * Per managed layer (comp layers, bounded):
 *   - type, name, parent, inFrame/outFrame, hidden;
 *   - every declared attribute's evaluated value at the playhead (`api.get`);
 *   - every animated attribute's keyframes (frame + evaluated value per frame,
 *     so restoring keyframes restores the animation);
 *   - incoming connections (`attrPath <- from`), best-effort.
 * Plus the comp id and the playhead frame, so a rollback restores the exact
 * instant, not just the values.
 *
 * ## What a rollback does
 *
 *   1. deletes layers that exist now but were not in the checkpoint (layers
 *      created by the rejected mutation);
 *   2. re-creates layers that were checkpointed but no longer exist, as their
 *      recorded type, and reports them in `recreated`;
 *   3. re-applies attribute values, keyframes, in/out frames and parenting for
 *      every surviving layer;
 *   4. reconnects incoming connections whose `from` reference parses;
 *   5. restores the active comp and the playhead frame.
 *
 * Both directions are one `api.exec` round trip — no per-layer chatter.
 */

export const CHECKPOINT_TYPE = 'checkpoint'
export const ROLLBACK_TYPE = 'rollback'

export const CHECKPOINT_MAX_LAYERS = 200
export const CHECKPOINT_MAX_KEYFRAMES_PER_ATTR = 64
export const CHECKPOINT_MAX_STATE_CHARS = 4_000_000

export interface CheckpointJob {
	seq: unknown
	compId: string
	snapshotId: string
	layerIds: string[]
}

export interface RollbackJob {
	seq: unknown
	compId: string
	snapshotId: string
	state: CheckpointStateDoc
}

/** The serialized scene state a checkpoint stores and a rollback consumes. */
export interface CheckpointStateDoc {
	version: 1
	compId: string
	frame: number
	layers: Array<{
		id: string
		type: string
		name: string
		parent: string | null
		inFrame: number | null
		outFrame: number | null
		hidden: boolean
		attrs: Record<string, unknown>
		animated: string[]
		keyframes: Record<string, Array<{ frame: number; value: unknown }>>
		connections: Array<{ attrPath: string; from: string }>
	}>
}

export interface CheckpointError {
	code: import('./Introspect.ts').ErrorCode
	error: string
}

/** A `snapshotId` that is safe to embed in a Windows filename. */
export function normalizeSnapshotId(value: unknown, fallback: string): string {
	const raw = typeof value === 'string' ? value.trim() : ''
	return (raw || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

export function normalizeCheckpointJob(parsed: Record<string, unknown>): { job: CheckpointJob } {
	const layerIds = Array.isArray(parsed.layerIds)
		? (parsed.layerIds as unknown[])
				.map((id) => (typeof id === 'string' ? id.trim() : ''))
				.filter(Boolean)
				.slice(0, CHECKPOINT_MAX_LAYERS)
		: []
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			snapshotId: normalizeSnapshotId(parsed.snapshotId, `checkpoint-${Date.now().toString(36)}`),
			layerIds,
		},
	}
}

export function normalizeRollbackJob(parsed: Record<string, unknown>): { job: RollbackJob } | { error: CheckpointError } {
	const state = parsed.state
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return { error: { code: 'STALLION_BAD_REQUEST', error: 'rollback requires a `state` object (from checkpoint).' } }
	}
	const doc = state as CheckpointStateDoc
	if (doc.version !== 1 || !Array.isArray(doc.layers)) {
		return { error: { code: 'STALLION_BAD_REQUEST', error: 'rollback state must be a version-1 checkpoint document with a `layers` array.' } }
	}
	const serialized = JSON.stringify(doc)
	if (serialized.length > CHECKPOINT_MAX_STATE_CHARS) {
		return { error: { code: 'STALLION_BAD_REQUEST', error: `rollback state exceeds ${CHECKPOINT_MAX_STATE_CHARS} characters.` } }
	}
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' && parsed.compId.trim() ? parsed.compId.trim() : String(doc.compId ?? ''),
			snapshotId: normalizeSnapshotId(parsed.snapshotId, 'rollback'),
			state: doc,
		},
	}
}

/**
 * The checkpoint runtime, as source for `api.exec`. Atomic (no undo group —
 * capturing state must not be undoable) and defensive per read: one odd layer
 * must not abort the capture.
 */
export function checkpointScript(job: CheckpointJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __cp = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
// Fast temp copy of the state document, next to the in-memory store the bridge
// keeps. The path is deterministic in the snapshotId, so a rollback that lost
// the in-memory entry (host restart) can still restore from disk.
var __writeFastCopy = function (snapshotId, state) {
	try {
		var __temp = String(api.getTempFolder()).replace(/\\\\/g, '/').replace(/\\/+$/, '');
		var __file = __temp + '/stallion-checkpoint-' + String(snapshotId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) + '.cv';
		if (api.writeToFile(__file, JSON.stringify(state), true)) return __file;
	} catch (e) {}
	return null;
};
var __started = Date.now();
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __cp.compId || __prevComp;
if (!__compId) {
	return { ok: false, kind: 'checkpoint', seq: __cp.seq, error: 'No active comp to checkpoint.', code: 'STALLION_NO_ACTIVE_COMP' };
}
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
var __ids = __cp.layerIds && __cp.layerIds.length
	? __cp.layerIds.slice(0, ${CHECKPOINT_MAX_LAYERS})
	: ((__read(function () { return api.getCompLayers(false); }) || []).slice(0, ${CHECKPOINT_MAX_LAYERS}));
var __layers = [];
for (var i = 0; i < __ids.length; i++) {
	var __id = __ids[i];
	var __type = __read(function () { return api.getLayerType(__id); });
	if (!__type) continue;
	var __declared = __read(function () { return api.getAttributes(__id); }) || [];
	var __animated = __read(function () { return api.getAnimatedAttributes(__id); }) || [];
	var __attrs = {};
	for (var a = 0; a < __declared.length; a++) {
		var __path = __declared[a];
		var __v = __read(function () { return api.get(__id, __path); });
		if (__v === null || __v === undefined) continue;
		if (Array.isArray(__v)) __attrs[__path] = __v.map(function (item) { return typeof item === 'number' ? item : String(item); });
		else if (typeof __v === 'object') __attrs[__path] = { x: __num(__v.x, 0), y: __num(__v.y, 0) };
		else __attrs[__path] = typeof __v === 'number' || typeof __v === 'boolean' || typeof __v === 'string' ? __v : String(__v);
	}
	// Keyframes are captured by visiting each animated attribute's frame times
	// and reading the evaluated value there — the same values a rollback writes
	// back through api.keyframe.
	var __keyframes = {};
	var __animatedList = [];
	for (var an = 0; an < __animated.length && __animatedList.length < 16; an++) {
		var __apath = __animated[an];
		var __times = __read(function () { return api.getKeyframeTimes(__id, __apath); });
		if (!Array.isArray(__times) || !__times.length) continue;
		var __samples = [];
		for (var t = 0; t < __times.length && __samples.length < ${CHECKPOINT_MAX_KEYFRAMES_PER_ATTR}; t++) {
			var __kfFrame = __num(__times[t], NaN);
			if (!isFinite(__kfFrame)) continue;
			__read(function () { return api.setFrame(__kfFrame); });
			var __kv = __read(function () { return api.get(__id, __apath); });
			if (__kv === null || __kv === undefined) continue;
			if (Array.isArray(__kv)) __kv = __kv.map(function (item) { return typeof item === 'number' ? item : String(item); });
			else if (typeof __kv === 'object') __kv = { x: __num(__kv.x, 0), y: __num(__kv.y, 0) };
			else if (typeof __kv !== 'number' && typeof __kv !== 'boolean' && typeof __kv !== 'string') __kv = String(__kv);
			__samples.push({ frame: __kfFrame, value: __kv });
		}
		if (__samples.length) {
			__keyframes[__apath] = __samples;
			__animatedList.push(__apath);
		}
	}
	__read(function () { return api.setFrame(__prevFrame); });
	var __connections = [];
	var __connected = __read(function () { return api.getInConnectedAttributes(__id); }) || [];
	for (var c = 0; c < __connected.length && __connections.length < 16; c++) {
		var __cpath = __connected[c];
		var __from = __read(function () { return api.getInConnection(__id, __cpath); });
		if (__from) __connections.push({ attrPath: __cpath, from: String(__from) });
	}
	var __hidden = __read(function () { return api.get(__id, 'hidden'); });
	__layers.push({
		id: __id,
		type: __type,
		name: String(__read(function () { return api.getNiceName(__id); }) || __id),
		parent: __read(function () { return api.getParent(__id); }) || null,
		inFrame: typeof __read(function () { return api.getInFrame(__id); }) === 'number' ? __num(__read(function () { return api.getInFrame(__id); }), 0) : null,
		outFrame: typeof __read(function () { return api.getOutFrame(__id); }) === 'number' ? __num(__read(function () { return api.getOutFrame(__id); }), 0) : null,
		hidden: __hidden === true || __hidden === 1 || __hidden === 'true',
		attrs: __attrs,
		animated: __animatedList,
		keyframes: __keyframes,
		connections: __connections
	});
}
return {
	ok: true,
	kind: 'checkpoint',
	seq: __cp.seq,
	snapshotId: __cp.snapshotId,
	compId: String(__compId),
	frame: __prevFrame,
	state: { version: 1, compId: String(__compId), frame: __prevFrame, layers: __layers },
	layerCount: __layers.length,
	tmpFile: __writeFastCopy(__cp.snapshotId, { version: 1, compId: String(__compId), frame: __prevFrame, layers: __layers }),
	elapsedMs: Date.now() - __started
};
})()`
}

/**
 * The rollback runtime. Consumes the checkpoint document verbatim (it travels
 * inside the job payload, so the bridge can source it from its in-memory map
 * or from the temp-file copy without a second host call).
 */
export function rollbackScript(job: RollbackJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __rb = ${JSON.stringify({ seq: job.seq, compId: job.compId, snapshotId: job.snapshotId, state: job.state })};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __started = Date.now();
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __rb.compId || __prevComp;
if (!__compId) {
	return { ok: false, kind: 'rollback', seq: __rb.seq, error: 'No active comp to roll back.', code: 'STALLION_NO_ACTIVE_COMP' };
}
if (__rb.compId && __rb.compId !== __prevComp) { __read(function () { return api.setActiveComp(__rb.compId); }); }
var __state = __rb.state;
var __recorded = {};
for (var r = 0; r < __state.layers.length; r++) __recorded[__state.layers[r].id] = __state.layers[r];
var __current = __read(function () { return api.getCompLayers(false); }) || [];
// 1. Layers the rejected mutation created (absent from the checkpoint) die.
var __deleted = [];
for (var d = 0; d < __current.length; d++) {
	if (__recorded[__current[d]] === undefined) {
		__read(function () { return api.deleteLayer(__current[d]); });
		__deleted.push(__current[d]);
	}
}
// 2. Layers the mutation deleted come back as their recorded type; attribute
//    re-application below then rebuilds their state. Cavalry assigns the new
//    id, so the report names both.
var __recreated = [];
var __idMap = {};
for (var rec = 0; rec < __state.layers.length; rec++) {
	var __layer = __state.layers[rec];
	var __exists = __read(function () { return api.getLayerType(__layer.id); });
	if (__exists) { __idMap[__layer.id] = __layer.id; continue; }
	var __newId = __read(function () { return api.create(__layer.type, __layer.name); });
	if (!__newId) continue;
	__idMap[__layer.id] = __newId;
	__recreated.push({ from: __layer.id, to: __newId });
}
// 3. Re-apply state onto every surviving layer (original or recreated id).
var __reapplied = [];
var __keyframesRestored = 0;
var __connectionsRestored = 0;
var __connectionsSkipped = 0;
for (var s = 0; s < __state.layers.length; s++) {
	var __entry = __state.layers[s];
	var __target = __idMap[__entry.id] || __entry.id;
	if (!__read(function () { return api.getLayerType(__target); })) continue;
	var __attrs = __entry.attrs || {};
	// api.set is dictionary-shaped on every host build, so the captured flat
	// record re-applies in one call per layer.
	__read(function () { return api.set(__target, __attrs); });
	// Animated attributes: wipe the mutation's keyframes, then write the
	// checkpointed ones back frame by frame.
	for (var ka = 0; ka < __entry.animated.length; ka++) {
		var __apath = __entry.animated[ka];
		__read(function () { return api.deleteAnimation(__target, __apath); });
		var __samples = __entry.keyframes[__apath] || [];
		for (var ks = 0; ks < __samples.length; ks++) {
			var __sample = __samples[ks];
			var __kfAttrs = {};
			__kfAttrs[__apath] = __sample.value;
			__read(function () { return api.keyframe(__target, __sample.frame, __kfAttrs); });
			__keyframesRestored++;
		}
		__reapplied.push(__target + ':' + __apath);
	}
	if (typeof __entry.inFrame === 'number') __read(function () { return api.setInFrame(__target, __entry.inFrame); });
	if (typeof __entry.outFrame === 'number') __read(function () { return api.setOutFrame(__target, __entry.outFrame); });
	__read(function () { return api.set(__target, { hidden: __entry.hidden === true }); });
	__read(function () { return api.rename(__target, __entry.name); });
}
// 4. Parenting (children before parents would orphan them; apply in reverse
//    declaration order so a parent's id maps exist by the time it is set) and
//    connections, best-effort: a 'from' reference that does not parse as
//    'id.attr' and does not map onto a known layer is counted, not failed.
for (var p = __state.layers.length - 1; p >= 0; p--) {
	var __pentry = __state.layers[p];
	var __ptarget = __idMap[__pentry.id] || __pentry.id;
	var __parent = __pentry.parent ? (__idMap[__pentry.parent] || __pentry.parent) : null;
	if (__parent) __read(function () { return api.parent(__ptarget, __parent); });
	else __read(function () { return api.unParent(__ptarget); });
}
for (var ce = 0; ce < __state.layers.length; ce++) {
	var __centry = __state.layers[ce];
	var __ctarget = __idMap[__centry.id] || __centry.id;
	var __conns = __centry.connections || [];
	for (var cn = 0; cn < __conns.length; cn++) {
		var __conn = __conns[cn];
		var __dot = String(__conn.from).lastIndexOf('.');
		var __srcId = __dot > 0 ? String(__conn.from).slice(0, __dot) : String(__conn.from);
		var __srcAttr = __dot > 0 ? String(__conn.from).slice(__dot + 1) : '';
		var __mapped = __idMap[__srcId];
		if (__mapped) __srcId = __mapped;
		var __srcOk = __read(function () { return api.getLayerType(__srcId); });
		if (__srcOk && __srcAttr) {
			__read(function () { return api.connect(__srcId, __srcAttr, __ctarget, __conn.attrPath, true); });
			__connectionsRestored++;
		} else {
			__connectionsSkipped++;
		}
	}
}
// 5. The exact instant.
__read(function () { return api.setFrame(__state.frame); });
return {
	ok: true,
	kind: 'rollback',
	seq: __rb.seq,
	snapshotId: __rb.snapshotId,
	compId: String(__compId),
	restoredFrame: __state.frame,
	layerCount: __state.layers.length,
	deleted: __deleted,
	recreated: __recreated,
	reappliedCount: __reapplied.length,
	keyframesRestored: __keyframesRestored,
	connectionsRestored: __connectionsRestored,
	connectionsSkipped: __connectionsSkipped,
	elapsedMs: Date.now() - __started
};
})()`
}
