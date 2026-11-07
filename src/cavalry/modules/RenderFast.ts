/**
 * `/render_frame_fast` — downscaled single-frame render for the verify loop.
 *
 * Stage 5's perceptual diffing does not need full-resolution PNGs while it is
 * converging; it needs *many* frames, cheaply. This kind renders one frame at
 * a caller-chosen downscale (`scaleFactor` 0.1..1, applied as the
 * `renderPNGFrame` scale percentage), writes it to the OS temp directory by
 * default, and — because the bridge itself is Node, unlike the script host —
 * reads the PNG back and inlines it as base64 when `inline` is not false, so
 * the hot loop never touches a second I/O stack.
 *
 * The script half is the proven snapshot runtime with a fast-path envelope;
 * the bridge half (Callbacks) fills in `pngBase64`/`contentHash` after the
 * file lands, exactly like the mock does for `snapshot`.
 */

export const RENDER_FRAME_FAST_TYPE = 'render_frame_fast'

export const RENDER_FAST_MIN_SCALE = 0.1
export const RENDER_FAST_MAX_SCALE = 1

export interface RenderFrameFastJob {
	seq: unknown
	compId: string
	frame: number
	restoreFrame: null
	scale: number
	scaleFactor: number
	outDir: string
	fileName: string
	inline: boolean
}

export interface RenderFrameFastError {
	code: import('./Introspect.ts').ErrorCode
	error: string
}

export function normalizeRenderFrameFastJob(
	parsed: Record<string, unknown>,
	defaultOutDir: string,
): { job: RenderFrameFastJob } | { error: RenderFrameFastError } {
	const frame = Number(parsed.frame ?? parsed.t)
	if (!Number.isFinite(frame)) {
		return { error: { code: 'STALLION_NO_FRAME', error: 'render_frame_fast requires a numeric `frame` (or `t`).' } }
	}
	// `scaleFactor` is the 0..1 form the refinement loop thinks in; `scale` is
	// the renderPNGFrame percentage. Either is accepted, scaleFactor wins.
	const rawScaleFactor = Number(parsed.scaleFactor)
	const rawScale = Number(parsed.scale ?? parsed.resolutionScale)
	const scaleFactor =
		Number.isFinite(rawScaleFactor) && rawScaleFactor > 0
			? Math.min(RENDER_FAST_MAX_SCALE, Math.max(RENDER_FAST_MIN_SCALE, rawScaleFactor))
			: Number.isFinite(rawScale) && rawScale > 0
				? Math.min(RENDER_FAST_MAX_SCALE, Math.max(RENDER_FAST_MIN_SCALE, rawScale / 100))
				: 0.5
	const safeStem =
		(typeof parsed.fileName === 'string' && parsed.fileName.trim()
			? parsed.fileName.trim()
			: `fast-${String(Math.round(frame)).padStart(6, '0')}`
		)
			.replace(/[\\/:*?"<>|]/g, '_')
			.slice(0, 80)
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			frame: Math.round(frame),
			restoreFrame: null,
			scale: Math.round(scaleFactor * 100),
			scaleFactor,
			// Scene URI form: forward slashes, always, so the same value crosses
			// the JSON boundary into the Cavalry host from any caller OS.
			outDir: (typeof parsed.outDir === 'string' && parsed.outDir.trim()
				? parsed.outDir.trim()
				: defaultOutDir
			).replace(/\\/g, '/'),
			fileName: safeStem,
			inline: parsed.inline !== false,
		},
	}
}

/**
 * The render runtime, as source for `api.exec`. Same shape as the snapshot
 * script: move, render, verify size/existence in the same call, restore, and
 * report a deterministic frame digest so a caller can tell this render from a
 * stale file without reading bytes.
 */
export function renderFrameFastScript(job: RenderFrameFastJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __rf = ${JSON.stringify(job)};
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
if (__rf.compId && __rf.compId !== __prevComp) { __read(function () { return api.setActiveComp(__rf.compId); }); }
var __ok = true, __error = null, __code = null;
if (!(__rf.compId || __prevComp)) { __ok = false; __error = 'No active comp to render.'; __code = 'STALLION_NO_ACTIVE_COMP'; }
try { if (__ok && __rf.frame !== __prevFrame) api.setFrame(__rf.frame); } catch (e) { __ok = false; __error = String(e && e.message ? e.message : e); __code = 'STALLION_RENDER_FAILED'; }
var __target = __rf.outDir + '/' + __rf.fileName;
if (__ok) {
	try { api.renderPNGFrame(__target, __rf.scale); } catch (e2) { __ok = false; __error = String(e2 && e2.message ? e2.message : e2); __code = 'STALLION_RENDER_FAILED'; }
}
var __renderedAt = Date.now();
var __bytes = __ok ? __read(function () { return api.getFileSize(__target + '.png'); }) : null;
var __exists = __bytes === null ? __read(function () { return api.filePathExists(__target + '.png'); }) : __bytes > 0;
if (__ok && __bytes !== null && !(__bytes > 0)) { __ok = false; __error = 'renderPNGFrame produced a zero-byte file at ' + __target + '.png'; __code = 'STALLION_RENDER_FAILED'; }
// Deterministic frame digest (see Introspect.snapshotScript): geometry over
// the top layers at this frame, hashed FNV-1a style. The script host has no
// crypto; the Node bridge fills contentHash in from the file it reads back.
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
	__frameHash = __dig(String(__rf.frame) + '#' + String(__rf.compId || __prevComp) + '#' + __sig);
}
if (__rf.frame !== __prevFrame) { __read(function () { return api.setFrame(__prevFrame); }); }
if (__rf.compId && __prevComp && __rf.compId !== __prevComp) { __read(function () { return api.setActiveComp(__prevComp); }); }
return {
	ok: __ok,
	kind: 'render_frame_fast',
	seq: __rf.seq,
	compId: String(__rf.compId || __prevComp),
	frame: __rf.frame,
	scaleFactor: __rf.scaleFactor,
	scale: __rf.scale,
	file: __target + '.png',
	fileName: __rf.fileName,
	inline: __rf.inline === true,
	renderedAt: __renderedAt,
	restoredFrame: __prevFrame,
	exists: __exists === true,
	sizeBytes: __bytes === null ? null : Number(__bytes),
	frameHash: __frameHash,
	error: __error,
	code: __code
};
})()`
}
