/**
 * Stallion — HTTP bridge callbacks.
 *
 * Bridge protocol (v0.10, see README):
 *
 *   POST /post  { type, code, path?, seq? }   — as before, plus an optional
 *              caller-supplied `seq` used to match results. Script posts may
 *              also carry `beatFrames?: number[]` and `diagnostics?: boolean`;
 *              `{ type: "render-frames", compId?, frames, resolutionScale?,
 *              format?, outDir? }` renders a batch of frames at verification
 *              resolution in one call.
 *   GET  /get   serves the latest payload: a script result
 *              ({type:"__stallion_result__", kind:"result", seq, ok,
 *              result?/error?, receipt?, state?}), a render-frames batch
 *              (kind:"render-frames") or a status heartbeat
 *              ({kind:"status", capabilities, …}).
 *
 * Script results are captured by wrapping the posted code so it reports
 * back over TWO channels — whichever reaches this context first wins:
 *
 *   1. a globalThis stash — works when Cavalry runs `api.exec` scripts in
 *      a shared context with Stallion
 *   2. a loopback WebClient POST (type "__stallion_result__") — works even
 *      when script contexts are isolated from this one
 *
 * Every script execution additionally produces a deterministic receipt
 * (sceneStateHash / consoleDiagnostics / beatBBoxes — see Receipt.ts).
 *
 * Clients that only need fire-and-forget execution (the VSCode extension)
 * are unaffected: `seq` is optional and the result channel is additive.
 */

import { RECEIPT_RUNTIME } from './Receipt.ts'

export const VERSION = '0.10.0'

const SCRIPT_ID = 'io.scenery.stallion'
const RESULT_TYPE = '__stallion_result__'
const RESULT_STASH = '__stallionResult__'
const RENDER_FRAMES_TYPE = 'render-frames'

export interface StallionConfig {
	host: string
	port: number
	token: string
}

interface PostPayload {
	type?: string
	code?: string
	path?: string
	seq?: unknown
	statePath?: string
	/** World-space bounding boxes are re-measured at these frames post-execution. */
	beatFrames?: unknown
	/** Probe api.set / api.connect for invalid attribute paths and dead links. */
	diagnostics?: unknown
	/** render-frames payload */
	compId?: unknown
	frames?: unknown
	resolutionScale?: unknown
	format?: unknown
	outDir?: unknown
}

/** Run fn, returning null on any throw — bridge code must never die on reads. */
function safe<T>(fn: () => T): T | null {
	try {
		return fn()
	} catch {
		return null
	}
}

export class Callbacks {
	#server: api.WebServer
	#config: StallionConfig

	constructor(server: api.WebServer, config: StallionConfig) {
		this.#server = server
		this.#config = config
	}

	/**
	 * Read `stallion.json` from Cavalry's application data folder.
	 * Keys: host (string), port (number), token (string — enables token
	 * authentication on POST and GET when non-empty).
	 * Falls back to the defaults on any error so a malformed or missing
	 * file can never keep the bridge from starting.
	 */
	static loadConfig(): StallionConfig {
		const defaults: StallionConfig = { host: '127.0.0.1', port: 8080, token: '' }
		const folder = safe(() => api.getAppDataFolder())
		if (!folder || typeof folder !== 'string') return defaults
		const file = folder.replace(/[\\/]$/, '') + '/stallion.json'
		if (safe(() => api.filePathExists(file)) !== true) return defaults
		const parsed = safe(() =>
			JSON.parse(api.readFromFile(file) as string),
		) as Partial<StallionConfig> | null
		if (!parsed || typeof parsed !== 'object') return defaults
		return {
			host: typeof parsed.host === 'string' && parsed.host ? parsed.host : defaults.host,
			port:
				typeof parsed.port === 'number' && Number.isFinite(parsed.port) && parsed.port > 0 && parsed.port < 65536
					? Math.floor(parsed.port)
					: defaults.port,
			token: typeof parsed.token === 'string' ? parsed.token : defaults.token,
		}
	}

	/** Serve a payload on GET /get (Cavalry's WebServer serves text/plain). */
	#serve = (payload: unknown): void => {
		safe(() => {
			this.#server.setResultForGet(
				typeof payload === 'string' ? payload : JSON.stringify(payload),
			)
		})
	}

	/** Heartbeat served on GET /get until the first script result exists. */
	serveStatus = (): void => {
		this.#serve({
			kind: 'status',
			stallion: VERSION,
			cavalry: safe(() => api.getCavalryVersion()),
			scene: safe(() => api.getSceneFilePath()),
			frame: safe(() => api.getFrame()),
			unSaved: safe(() => api.sceneHasUnsavedChanges()),
			capabilities: { receipt: true, renderFrames: true, mock: false },
			ts: Date.now(),
		})
	}

	/**
	 * Shared-context fast path: after api.exec returns, the wrapper may have
	 * stashed its JSON result on globalThis. Serve it if the seq matches.
	 */
	#serveStashed = (seq: unknown): void => {
		const stash = safe(() => (globalThis as unknown as Record<string, unknown>)[RESULT_STASH])
		if (typeof stash !== 'string') return
		const parsed = safe(() => JSON.parse(stash)) as PostPayload | null
		if (parsed && parsed.seq === seq) this.#serve(stash)
	}

	onPost = (): void => {
		this.#handlePost(safe(() => this.#server.getNextPost() as unknown as { result?: string } | null))
		// Drain queued posts so bursts are not delayed one tick each.
		let guard = 64
		while (guard-- > 0) {
			const count = safe(() => this.#server.postCount() as unknown as number)
			if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) break
			this.#handlePost(safe(() => this.#server.getNextPost() as unknown as { result?: string } | null))
		}
	}

	#handlePost = (post: { result?: string } | null): void => {
		if (!post || typeof post.result !== 'string') {
			console.error('Stallion: No post data')
			return
		}
		const parsed = safe(() => JSON.parse(post.result)) as PostPayload | null
		if (!parsed || typeof parsed !== 'object') {
			console.error('Stallion: Failed to parse request as JSON')
			return
		}
		console.log('Stallion: Data received')

		// Internal channel: a finished script reporting its result.
		if (parsed.type === RESULT_TYPE) {
			this.#serve(post.result)
			return
		}

		// Batch frame verification: render frames in one call and serve the batch.
		if (parsed.type === RENDER_FRAMES_TYPE) {
			this.#handleRenderFrames(parsed)
			return
		}

		const { type, code, path, seq, statePath } = parsed
		if (!type && !path) {
			console.error('Stallion: Missing/empty `type` key in request')
			return
		}
		if (!code && !path) {
			console.error('Stallion: Missing/empty `code` or `path` key in request')
			return
		}

		// NOTE: Supports `path` for backwards compatibility
		if (type === 'script' || path) {
			if (code && path) {
				console.warn('Stallion: `code` and `path` keys are both in the request, executing `path`')
			}
			if (path) {
				const exists = api.filePathExists(path)
				if (!exists) {
					this.#serve({ kind: 'result', seq, ok: false, error: `No script found at ${path}` })
					console.error(`Stallion: No script found at ${path}`)
					return
				}
				const success = ui.runFileScript(path) as unknown as boolean
				if (success) {
					this.#serve({ kind: 'result', seq, ok: true, note: 'file script executed (no captured result)' })
					console.log('Stallion: Script successfully executed')
					return
				}
				this.#serve({ kind: 'result', seq, ok: false, error: 'Script failed to execute' })
				console.error('Stallion: Script failed to execute')
				return
			}
			if (code) {
				const success = api.exec(
					SCRIPT_ID,
					this.#wrapped(code, seq, statePath, {
						beatFrames: parsed.beatFrames,
						diagnostics: parsed.diagnostics === true,
					}),
				)
				this.#serveStashed(seq)
				if (success) {
					console.log('Stallion: Script successfully executed')
					return
				}
				this.#serve({ kind: 'result', seq, ok: false, error: 'Script failed to execute' })
				console.error('Stallion: Script failed to execute')
				return
			}
			this.#serve({ kind: 'result', seq, ok: false, error: 'Script failed to execute' })
			console.error('Stallion: Script failed to execute')
			return
		}

		if (typeof type === 'string' && (type.startsWith('javaScript') || type.startsWith('sksl'))) {
			let selection = api.getSelection()
			if (!selection.length) {
				const layerId = api.create(type)
				selection = [layerId]
			}
			let attribute = 'expression'
			if (type === 'javaScriptShape') {
				attribute = 'generator.expression'
			}
			if (type.startsWith('sksl')) {
				attribute = 'code'
			}
			const applied: string[] = []
			const skipped: string[] = []
			for (const layerId of selection) {
				const layerType = api.getLayerType(layerId)
				if (layerType !== type) {
					const name = api.getNiceName(layerId)
					skipped.push(String(name))
					console.warn(`Stallion: Skipped layer '${name}' because it is not of type '${type}'`)
					continue
				}
				api.set(layerId, { [attribute]: code })
				applied.push(String(layerId))
			}
			this.#serve({ kind: 'result', seq, ok: true, applied, skipped })
			console.log(`Stallion: Successfully applied expression`)
			return
		}

		if (typeof type === 'string' && type.toLowerCase().includes('render')) {
			const items = api.getRenderQueueItems()
			const applied: string[] = []
			for (const layerId of items) {
				const selected = api.get(layerId, 'selected')
				if (selected) {
					api.set(layerId, { [type]: code })
					applied.push(String(layerId))
				}
			}
			this.#serve({ kind: 'result', seq, ok: true, applied })
			console.log(`Stallion: Successfully applied render expression`)
			return
		}

		this.#serve({ kind: 'result', seq, ok: false, error: `Unexpected type '${type}'` })
		console.error(`Stallion: Unexpected type '${type}'`)
	}

	/**
	 * Wrap user code so its return value (or thrown error) is delivered back
	 * to the bridge. The wrapper runs inside api.exec; it reports through a
	 * globalThis stash and a loopback WebClient POST (see file header).
	 *
	 * After the atomic Undo group has closed, the wrapper captures a
	 * deterministic receipt (sceneStateHash / consoleDiagnostics / beatBBoxes
	 * — see Receipt.ts) and a compact execution snapshot written to
	 * `statePath` (or ~/.cavalry-mcp/last-execution-state.json). Marked
	 * cavalry-mcp scripts already carry their own telemetry; for those the
	 * snapshot is picked up from globalThis and attached to the envelope.
	 * `options.diagnostics` additionally probes every api.set attribute path
	 * (via getAttributeDefinition + read-back) and every api.connect link
	 * (endpoint existence + getInConnection read-back) so silent failures are
	 * reported instead of swallowed.
	 */
	#wrapped = (
		code: string,
		seq: unknown,
		statePath?: string,
		options?: { beatFrames?: unknown; diagnostics?: boolean },
	): string => {
		const origin = `http://${this.#config.host}:${this.#config.port}`
		const token = this.#config.token
		const seqLiteral = JSON.stringify(seq) ?? 'undefined'
		const statePathLiteral = JSON.stringify(statePath ?? '')
		const isAtomic = code.startsWith('/* cavalry-mcp:atomic */')
		const atomic = isAtomic
			? code
			: `(() => {
	var __undo = typeof api.startUndoGroup === 'function';
	if (__undo) api.startUndoGroup('AI Motion Batch');
	try {
		return (() => { ${code}\n})();
	} finally {
		if (__undo) api.endUndoGroup();
	}
})()`
		const telemetryInit = isAtomic
			? ''
			: `var __telemetry = (function () {
	var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
	var __top = function () { var ids = __read(function () { return api.getCompLayers(true); }); return Array.isArray(ids) ? ids : []; };
	var __before = __top();
	var __started = Date.now();
	var __snapshot = {
		seq: ${seqLiteral}, status: 'ok', errorStack: null, createdLayerIds: [],
		activeSelection: [], compInfo: null, boundingBoxes: {}, modifiedLayerIds: []
	};
	var __compInfo = function () {
		var id = __read(function () { return api.getActiveComp(); });
		if (!id) return null;
		var fps = __read(function () { return api.get(id, 'fps'); });
		var resolution = __read(function () { return api.get(id, 'resolution'); });
		var startFrame = __read(function () { return api.get(id, 'startFrame'); });
		var endFrame = __read(function () { return api.get(id, 'endFrame'); });
		if (startFrame == null) startFrame = __read(function () { return api.getInFrame(id); });
		if (endFrame == null) endFrame = __read(function () { return api.getOutFrame(id); });
		var res = null;
		if (Array.isArray(resolution)) res = [Number(resolution[0]) || 0, Number(resolution[1]) || 0];
		else if (resolution && typeof resolution === 'object') res = [Number(resolution.x) || 0, Number(resolution.y) || 0];
		return {
			id: String(id), name: __read(function () { return api.getNiceName(id); }),
			fps: fps == null ? null : Number(fps),
			startFrame: startFrame == null ? null : Number(startFrame),
			endFrame: endFrame == null ? null : Number(endFrame),
			resolution: res, width: res ? res[0] : null, height: res ? res[1] : null
		};
	};
	var __finalize = function () {
		try {
			var after = __top();
			var seen = {};
			for (var i = 0; i < __before.length; i++) seen[__before[i]] = true;
			for (var j = 0; j < after.length; j++) if (!seen[after[j]]) __snapshot.createdLayerIds.push(after[j]);
			__snapshot.activeSelection = __read(function () { return api.getSelection(); }) || [];
			__snapshot.compInfo = __compInfo();
			var ids = __snapshot.createdLayerIds.concat(__snapshot.activeSelection.filter(function (id) { return after.indexOf(id) >= 0; }));
			var boxed = {};
			for (var k = 0; k < ids.length && k < 50; k++) {
				var id = ids[k];
				if (boxed[id]) continue;
				boxed[id] = true;
				var bb = __read(function () { return api.getBoundingBox(id, true); });
				if (bb && typeof bb === 'object') {
					var box = { x: Number(bb.x) || 0, y: Number(bb.y) || 0, width: Number(bb.width) || 0, height: Number(bb.height) || 0 };
					if (bb.centre) box.centre = { x: Number(bb.centre.x) || 0, y: Number(bb.centre.y) || 0 };
					__snapshot.boundingBoxes[id] = box;
				}
			}
			__snapshot.durationMs = Date.now() - __started;
			__snapshot.writtenAt = new Date().toISOString();
			try {
				var folder = api.getFolderFromPath(__statePath);
				if (folder && typeof api.makeFolder === 'function') __read(function () { return api.makeFolder(folder); });
			} catch (e) {}
			try {
				api.writeToFile(__statePath, JSON.stringify(__snapshot), true);
			} catch (writeErr) {
				try { api.writeToFile(__statePath, JSON.stringify({ seq: ${seqLiteral}, status: __snapshot.status, errorStack: __snapshot.errorStack, writeFailed: String(writeErr) }), true); } catch (e) {}
			}
			try { globalThis.__stallionState = __snapshot; } catch (e) {}
		} catch (e) {}
	};
	return { snapshot: __snapshot, finalize: __finalize };
})()`
		const telemetryFinish = isAtomic
			? `try {
	var __shared = globalThis.__stallionState;
	if (__shared && __shared.seq === ${seqLiteral}) __state = __shared;
} catch (e) {}`
			: `if (__telemetry && __telemetry.finalize) {
	__telemetry.finalize();
	__state = __telemetry.snapshot;
}`
		const beatFrames = Array.isArray(options?.beatFrames)
			? (options.beatFrames as unknown[]).map((f) => Math.round(Number(f))).filter((f) => Number.isFinite(f)).slice(0, 32)
			: []
		const diagnosticsProbes =
			options?.diagnostics === true
				? `(function () {
	if (typeof api === 'undefined' || !__stallionReceipt) return;
	var origSet = api.set;
	if (typeof origSet === 'function') {
		try {
			api.set = function (id, attrs) {
				var names = attrs && typeof attrs === 'object' ? Object.keys(attrs) : [];
				for (var i = 0; i < names.length; i++) {
					(function (attr) {
						var def = __stallionReceipt.read(function () { return api.getAttributeDefinition(id, attr); });
						if (def === null || def === undefined) {
							var value = __stallionReceipt.read(function () { return api.get(id, attr); });
							if (value === null || value === undefined) __diag.invalidAttrs.push(String(id) + '.' + String(attr));
						}
					})(names[i]);
				}
				return origSet.apply(api, arguments);
			};
		} catch (e) { __consoleLog.push({ level: 'warn', text: 'Stallion: api.set probe unavailable' }); }
	}
	var origConnect = api.connect;
	if (typeof origConnect === 'function') {
		try {
			api.connect = function (srcId, srcAttr, dstId, dstAttr) {
				var srcOk = __stallionReceipt.read(function () { return api.getLayerType(srcId); });
				var dstOk = __stallionReceipt.read(function () { return api.getLayerType(dstId); });
				var result = origConnect.apply(api, arguments);
				if (srcOk === null || srcOk === undefined || dstOk === null || dstOk === undefined) {
					__diag.failedConnections.push(String(srcId) + '->' + String(dstId));
					return result;
				}
				var link = __stallionReceipt.read(function () { return api.getInConnection(dstId, dstAttr); });
				var dead = link === null || link === undefined || (Array.isArray(link) && link.length === 0);
				if (dead) __diag.failedConnections.push(String(srcId) + ':' + String(srcAttr) + '->' + String(dstId) + ':' + String(dstAttr));
				return result;
			};
		} catch (e) { __consoleLog.push({ level: 'warn', text: 'Stallion: api.connect probe unavailable' }); }
	}
})();`
				: ''
		return `(function () {
var __deliver = function (payload) {
	try { globalThis.${RESULT_STASH} = payload; } catch (e) {}
	try {
		var __client = new api.WebClient(${JSON.stringify(origin)});
		${token ? `__client.setTokenAuthentication(${JSON.stringify(token)});` : ''}
		__client.post('/post', payload, 'application/json');
	} catch (e) {}
};
var __statePath = ${statePathLiteral};
if (!__statePath) {
	try { __statePath = api.getHomeFolder() + '/.cavalry-mcp/last-execution-state.json'; } catch (e) {}
}
${RECEIPT_RUNTIME}
var __state = null;
${telemetryInit}
if (typeof __telemetry !== 'undefined' && __telemetry && __telemetry.snapshot) __state = __telemetry.snapshot;
var __consoleLog = [];
var __consoleRestore = (function () {
	var entries = __consoleLog;
	var saved = {};
	if (typeof console === 'undefined') return function () {};
	var levels = ['log', 'info', 'warn', 'error'];
	for (var i = 0; i < levels.length; i++) {
		(function (level) {
			var original = typeof console[level] === 'function' ? console[level] : null;
			saved[level] = original;
			try {
				console[level] = function () {
					var parts = [];
					for (var a = 0; a < arguments.length; a++) {
						parts.push(typeof arguments[a] === 'string' ? arguments[a] : (function () { try { return JSON.stringify(arguments[a]); } catch (e) { return String(arguments[a]); } })());
					}
					entries.push({ level: level, text: parts.join(' ') });
					if (original) { try { original.apply(console, arguments); } catch (e) {} }
				};
			} catch (e) { entries.push({ level: 'warn', text: 'Stallion: console.' + level + ' could not be captured' }); }
		})(levels[i]);
	}
	return function () {
		for (var key in saved) { try { console[key] = saved[key]; } catch (e) {} }
	};
})();
var __diag = { invalidAttrs: [], failedConnections: [] };
${diagnosticsProbes}
var __out = { type: ${JSON.stringify(RESULT_TYPE)}, kind: 'result', seq: ${seqLiteral}, ok: true };
try {
	var __result;
	var __returned = ${atomic};
	if (typeof __result === 'undefined') __result = __returned;
	if (typeof __result !== 'undefined') __out.result = __result;
} catch (err) {
	__out.ok = false;
	__out.error = err.toString();
	__out.stack = err.stack;
	if (__state) { __state.status = 'error'; __state.errorStack = String(err.stack || err); }
} finally {
	try { __consoleRestore(); } catch (e) {}
}
${telemetryFinish}
if (__state) {
	if (__out.ok === false && __state.status !== 'error') { __state.status = 'error'; __state.errorStack = __out.stack || __out.error || null; }
	__out.state = __state;
}
try {
	var __receiptIds = [];
	if (__state && Array.isArray(__state.createdLayerIds)) __receiptIds = __receiptIds.concat(__state.createdLayerIds);
	if (__state && Array.isArray(__state.activeSelection)) __receiptIds = __receiptIds.concat(__state.activeSelection);
	var __beatFrames = ${JSON.stringify(beatFrames)};
	__out.receipt = {
		sceneStateHash: __stallionReceipt.hash(__stallionReceipt.facts()),
		consoleDiagnostics: __stallionReceipt.consoleLines(__consoleLog),
		beatBBoxes: __stallionReceipt.beatBoxes(__receiptIds, __beatFrames)
	};
	if (__diag.invalidAttrs.length || __diag.failedConnections.length) __out.receipt.apiDiagnostics = __diag;
	if (__state) __state.receipt = __out.receipt;
} catch (e) {
	__out.receipt = { sceneStateHash: null, consoleDiagnostics: [], beatBBoxes: {}, receiptError: String(e) };
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(RESULT_TYPE)}, kind: 'result', seq: ${seqLiteral}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`
	}

	/**
	 * Serve the stashed result with its `result` document promoted to the top
	 * level under a different `kind`. Used by render-frames so clients read
	 * one flat envelope instead of digging into `.result`.
	 */
	#serveReshaped = (seq: unknown, reshape: (doc: Record<string, unknown>) => Record<string, unknown>): void => {
		const stash = safe(() => (globalThis as unknown as Record<string, unknown>)[RESULT_STASH])
		if (typeof stash !== 'string') return
		const parsed = safe(() => JSON.parse(stash)) as Record<string, unknown> | null
		if (!parsed || parsed.seq !== seq) return
		this.#serve(JSON.stringify(reshape(parsed)))
	}

	/**
	 * Batch frame verification: step the playhead across `frames`, capture the
	 * viewport at downscaled verification resolution via `api.renderPNGFrame`
	 * and report every rendered file (plus sizes and the comp resolution) in
	 * one envelope on GET /get. The playhead and active comp are always
	 * restored. PNG bytes stay on disk — Cavalry's scripting host has no
	 * binary read, so `format: "raw_rgba"` is acknowledged with a note and
	 * callers read the files over localhost; the mock bridge serves both
	 * formats as real inline buffers.
	 */
	#handleRenderFrames = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const rawFrames = Array.isArray(parsed.frames) ? (parsed.frames as unknown[]) : []
		const frames = rawFrames
			.map((f) => Math.round(Number(f)))
			.filter((f) => Number.isFinite(f) && Math.abs(f) < 1e9)
		if (!frames.length) {
			this.#serve({ kind: 'render-frames', seq, ok: false, error: 'render-frames requires a non-empty frames array' })
			return
		}
		if (frames.length > 2_000) {
			this.#serve({ kind: 'render-frames', seq, ok: false, error: 'render-frames accepts at most 2000 frames per batch' })
			return
		}
		const resolutionScale = Number(parsed.resolutionScale)
		const scale =
			Number.isFinite(resolutionScale) && resolutionScale > 0 ? Math.min(4, Math.max(0.01, resolutionScale)) : 0.5
		const format = parsed.format === 'raw_rgba' ? 'raw_rgba' : 'png_buffer'
		const compId = typeof parsed.compId === 'string' && parsed.compId.trim() ? parsed.compId.trim() : ''
		const outDir = typeof parsed.outDir === 'string' && parsed.outDir.trim() ? parsed.outDir.trim() : ''
		const success = api.exec(SCRIPT_ID, renderFramesScript({ frames, scale, format, compId, outDir, seq }))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, type: doc.type, seq: doc.seq, kind: 'render-frames', ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve({ kind: 'render-frames', seq, ok: false, error: 'Script failed to execute' })
			console.error('Stallion: render-frames script failed to execute')
			return
		}
		console.log('Stallion: render-frames batch executed')
	}
}

interface RenderFramesJob {
	frames: number[]
	scale: number
	format: string
	compId: string
	outDir: string
	seq: unknown
}

/** One atomic script: render every requested frame, then restore playhead and comp. */
function renderFramesScript(job: RenderFramesJob): string {
	return `var __rf = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __rf.compId || __prevComp;
if (__rf.compId) api.setActiveComp(__rf.compId);
var __prevFrame = __read(function () { return api.getFrame(); });
var __res = __read(function () { return api.get(__compId, 'resolution'); });
var __width = null, __height = null;
if (Array.isArray(__res)) { __width = Number(__res[0]) || null; __height = Number(__res[1]) || null; }
else if (__res && typeof __res === 'object') { __width = Number(__res.x) || null; __height = Number(__res.y) || null; }
var __dir = __rf.outDir;
if (!__dir) {
	var __seqText = String(__rf.seq == null ? 'batch' : __rf.seq).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
	__dir = api.getHomeFolder() + '/.stallion/frames/' + (__seqText || 'batch');
}
var __folder = __read(function () { return api.getFolderFromPath(__dir); });
if (__folder && typeof api.makeFolder === 'function') __read(function () { return api.makeFolder(__folder); });
var __rendered = [];
var __failed = [];
var __scalePct = Math.max(1, Math.min(400, Math.round(__rf.scale * 100)));
try {
	for (var __i = 0; __i < __rf.frames.length; __i++) {
		var __frame = __rf.frames[__i];
		try {
			api.setFrame(__frame);
			var __padded = String(Math.abs(__frame));
			while (__padded.length < 6) __padded = '0' + __padded;
			var __base = __dir + '/frame-' + (__frame < 0 ? '-' : '') + __padded;
			api.renderPNGFrame(__base, __scalePct);
			var __file = __base + '.png';
			var __bytes = __read(function () { return api.getFileSize(__file); });
			__rendered.push({ frame: __frame, file: __file, bytes: __bytes == null ? null : Number(__bytes) });
		} catch (__err) {
			__failed.push({ frame: __frame, error: String(__err && __err.message ? __err.message : __err) });
		}
	}
} finally {
	if (__prevFrame != null) __read(function () { return api.setFrame(__prevFrame); });
	if (__rf.compId && __prevComp) __read(function () { return api.setActiveComp(__prevComp); });
}
var __inlineNote = null;
if (__rf.format === 'raw_rgba') {
	__inlineNote = 'raw_rgba pixel readback is unavailable through this bridge; the rendered PNG files are listed per frame — read them over localhost, or use a mock bridge for inline buffers.';
}
__result = {
	ok: __rendered.length > 0,
	kind: 'render-frames',
	format: __rf.format,
	scale: __rf.scale,
	scalePercent: __scalePct,
	compId: __compId == null ? null : String(__compId),
	width: __width,
	height: __height,
	outDir: __dir,
	rendered: __rendered,
	failed: __failed,
	inlineNote: __inlineNote
};`
}
