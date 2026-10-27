/**
 * Stallion — HTTP bridge callbacks.
 *
 * Bridge protocol (v0.9, see README):
 *
 *   POST /post  { type, code, path?, seq? }   — as before, plus an optional
 *              caller-supplied `seq` used to match results
 *   GET  /get   serves the latest payload: a script result
 *              ({type:"__stallion_result__", kind:"result", seq, ok,
 *              result?/error?}) once one has been produced, otherwise a
 *              status heartbeat ({kind:"status", …}).
 *
 * Script results are captured by wrapping the posted code so it reports
 * back over TWO channels — whichever reaches this context first wins:
 *
 *   1. a globalThis stash — works when Cavalry runs `api.exec` scripts in
 *      a shared context with Stallion
 *   2. a loopback WebClient POST (type "__stallion_result__") — works even
 *      when script contexts are isolated from this one
 *
 * Clients that only need fire-and-forget execution (the VSCode extension)
 * are unaffected: `seq` is optional and the result channel is additive.
 */

export const VERSION = '0.9.0'

const SCRIPT_ID = 'io.scenery.stallion'
const RESULT_TYPE = '__stallion_result__'
const RESULT_STASH = '__stallionResult__'

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
				const success = api.exec(SCRIPT_ID, this.#wrapped(code, seq, statePath))
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
	 */
	/**
	 * Wrap user code so its return value (or thrown error) is delivered back
	 * to the bridge. The wrapper runs inside api.exec; it reports through a
	 * globalThis stash and a loopback WebClient POST (see file header).
	 *
	 * After the atomic Undo group has closed, a compact execution snapshot is
	 * written to `statePath` (or ~/.cavalry-mcp/last-execution-state.json).
	 * Marked cavalry-mcp scripts already carry their own telemetry; for those
	 * the snapshot is picked up from globalThis and attached to the envelope.
	 */
	#wrapped = (code: string, seq: unknown, statePath?: string): string => {
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
var __state = null;
${telemetryInit}
if (typeof __telemetry !== 'undefined' && __telemetry && __telemetry.snapshot) __state = __telemetry.snapshot;
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
}
${telemetryFinish}
if (__state) {
	if (__out.ok === false && __state.status !== 'error') { __state.status = 'error'; __state.errorStack = __out.stack || __out.error || null; }
	__out.state = __state;
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(RESULT_TYPE)}, kind: 'result', seq: ${seqLiteral}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`
	}
}
