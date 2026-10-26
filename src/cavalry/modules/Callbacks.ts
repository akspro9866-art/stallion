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

		const { type, code, path, seq } = parsed
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
				const success = api.exec(SCRIPT_ID, this.#wrapped(code, seq))
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
	#wrapped = (code: string, seq: unknown): string => {
		const origin = `http://${this.#config.host}:${this.#config.port}`
		const token = this.#config.token
		const seqLiteral = JSON.stringify(seq) ?? 'undefined'
		const atomic = code.startsWith('/* cavalry-mcp:atomic */')
			? code
			: `(() => {
	api.startUndoGroup('AI Motion Batch');
	try {
		return (() => { ${code}\n})();
	} finally {
		api.endUndoGroup();
	}
})()`
		return `(function () {
var __deliver = function (payload) {
	try { globalThis.${RESULT_STASH} = payload; } catch (e) {}
	try {
		var __client = new api.WebClient(${JSON.stringify(origin)});
		${token ? `__client.setTokenAuthentication(${JSON.stringify(token)});` : ''}
		__client.post('/post', payload, 'application/json');
	} catch (e) {}
};
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
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(RESULT_TYPE)}, kind: 'result', seq: ${seqLiteral}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`
	}
}
