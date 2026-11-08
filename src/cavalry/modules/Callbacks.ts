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
import {
	BATCH_EVAL_AND_CAPTURE_TYPE,
	batchCaptureFailure,
	batchEvalAndCaptureScript,
	normalizeBatchEvalAndCaptureJob,
	type BatchEvalAndCaptureResponse,
} from './BatchEvalAndCapture.ts'
import {
	BATCH_STEP_TYPE,
	batchStepScript,
	normalizeBatchStepJob,
} from './BatchStep.ts'
import {
	BATCH_INSPECT_TYPE,
	batchInspectScript,
	normalizeBatchInspectJob,
} from './BatchInspect.ts'
import {
	EXPORT_COMP_RIG_OVERRIDES_TYPE,
	exportCompRigOverridesScript,
	normalizeExportRigOverridesJob,
} from './ExportCompRigOverrides.ts'
import {
	CHECKPOINT_TYPE,
	ROLLBACK_TYPE,
	checkpointScript,
	normalizeCheckpointJob,
	normalizeRollbackJob,
	rollbackScript,
	type CheckpointStateDoc,
} from './Checkpoint.ts'
import { RENDER_FRAME_FAST_TYPE, normalizeRenderFrameFastJob, renderFrameFastScript } from './RenderFast.ts'
import { MG_HELPERS_SOURCE, MG_MANIFEST_RUNTIME } from './mgRuntime.ts'
import {
	ERROR_CODES,
	LAYERS_TYPE,
	SNAPSHOT_BATCH_TYPE,
	SNAPSHOT_TYPE,
	STATE_TYPE,
	errorEnvelope,
	normalizeReadbackJob,
	normalizeSnapshotBatchJob,
	normalizeSnapshotJob,
	readbackScript,
	snapshotBatchScript,
	snapshotScript,
	type ReadbackJob,
	type SnapshotBatchJob,
	type SnapshotJob,
} from './Introspect.ts'

export const VERSION = '0.11.0'

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
	batchEvalAndCaptureResult?: BatchEvalAndCaptureResponse
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
	/** state / layers / snapshot payload — see Introspect.ts */
	frame?: unknown
	t?: unknown
	offset?: unknown
	limit?: unknown
	attrs?: unknown
	attributes?: unknown
	budgetMs?: unknown
	scale?: unknown
	fileName?: unknown
	/** batch_inspect / checkpoint / rollback / render_frame_fast payload */
	layerIds?: unknown
	includeHidden?: unknown
	snapshotId?: unknown
	state?: unknown
	scaleFactor?: unknown
	inline?: unknown
	/** Names the `_mg.*` helper that built this payload, echoed into error envelopes. */
	mgCall?: unknown
	/**
	 * Script posts may set helpers:true to have the preloaded `_mg`/`_rb`
	 * runtime defined in the script's scope — the caller then sends compact
	 * `_mg` calls without carrying the helper library on every request.
	 */
	helpers?: unknown
}

/** Run fn, returning null on any throw — bridge code must never die on reads. */
function safe<T>(fn: () => T): T | null {
	try {
		return fn()
	} catch {
		return null
	}
}

/**
 * Canonical `kind` values that introspection scripts return *inside* the
 * wrapped `result` document. `#wrapped` always labels its own envelope
 * `kind: "result"`; the readback/snapshot/batch handlers promote the inner
 * document to the top level for GET /get (see `#serveReshaped`).
 */
const CANONICAL_RESULT_KINDS = new Set<string>([
	'state',
	'layers',
	'snapshot',
	'snapshot-batch',
	'batch-step',
	'batch_inspect',
	'export_comp_rig_overrides',
	'checkpoint',
	'rollback',
	'render_frame_fast',
])

/**
 * Apply `#serveReshaped`'s promotion to a queued loopback envelope.
 *
 * Live hosts deliver every wrapped script on TWO channels: the shared-context
 * stash (consumed synchronously by `#serveReshaped`) and a loopback
 * `__stallion_result__` POST that `onPost` drains a tick later. Without this
 * reshape the loopback overwrites the canonical envelope with the raw
 * wrapper, so a client that asked for `kind: "state"` receives
 * `kind: "result"` — the mock never sees it because it serves introspection
 * directly. The seq guard keeps stale stashes and user scripts that happen to
 * return a lookalike document from being promoted.
 */
function reshapeWrappedResult(doc: Record<string, unknown>): Record<string, unknown> | null {
	const inner =
		typeof doc.result === 'object' && doc.result !== null && !Array.isArray(doc.result)
			? (doc.result as Record<string, unknown>)
			: null
	if (!inner) return null
	const kind = typeof inner.kind === 'string' ? inner.kind : ''
	if (!CANONICAL_RESULT_KINDS.has(kind)) return null
	if ((inner.seq ?? null) !== (doc.seq ?? null)) return null
	return { ...inner, seq: doc.seq, kind, ok: doc.ok === true && inner.ok !== false }
}

export class Callbacks {
	#server: api.WebServer
	#config: StallionConfig
	/** In-memory checkpoint store: snapshotId → captured state (see Checkpoint.ts). */
	#checkpoints = new Map<string, { capturedAt: number; state: CheckpointStateDoc; tmpFile: string | null }>()

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
			capabilities: {
				receipt: true,
				renderFrames: true,
				batchEvalAndCapture: true,
				batchEvalAndCaptureRollback: typeof (api as unknown as { undo?: unknown }).undo === 'function',
				// Full-scene save/openScene isolation for hosts without api.undo.
				// Presence-only evidence; the strict client still proves a real
				// save/restore round trip before any convergence mutation.
				batchEvalAndCaptureCheckpoint: ['saveSceneAs', 'openScene', 'getSceneFilePath', 'sceneHasUnsavedChanges', 'filePathExists', 'getFileSize']
					.every((key) => typeof (api as unknown as Record<string, unknown>)[key] === 'function'),
				// Introspection rides on POST /post as `type`, not as URL routes: Cavalry's
				// WebServer serves exactly /get and /post. See Introspect.ts.
				introspect: ['state', 'layers', 'snapshot', 'snapshot-batch', BATCH_STEP_TYPE, BATCH_INSPECT_TYPE, EXPORT_COMP_RIG_OVERRIDES_TYPE, CHECKPOINT_TYPE, ROLLBACK_TYPE, RENDER_FRAME_FAST_TYPE],
				// `_mg`/`_rb` + the declarative manifest interpreter are preloaded at
				// startup, so batch-step and helpers:true scripts carry no runtime bytes.
				mgRuntime: true,
				errorEnvelope: 1,
				mock: false,
			},
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
			// New batches carry an already canonical document. Never re-wrap it:
			// the queued loopback must match the shared-context stash byte-for-byte.
			if (parsed.batchEvalAndCaptureResult?.kind === BATCH_EVAL_AND_CAPTURE_TYPE) {
				this.#serve(parsed.batchEvalAndCaptureResult)
				return
			}
			// Introspection scripts return their canonical document as the wrapped
			// expression value. Promote it exactly like #serveReshaped does, or this
			// later-served loopback would replace the canonical envelope with
			// kind:"result" and every correlated introspection read would miss.
			const reshaped = reshapeWrappedResult(parsed as unknown as Record<string, unknown>)
			this.#serve(reshaped ?? post.result)
			return
		}

		if (parsed.type === BATCH_EVAL_AND_CAPTURE_TYPE) {
			this.#handleBatchEvalAndCapture(parsed)
			return
		}

		// Batch frame verification: render frames in one call and serve the batch.
		if (parsed.type === RENDER_FRAMES_TYPE) {
			this.#handleRenderFrames(parsed)
			return
		}

		// Atomic execute + step + measure + render round trip (see BatchStep.ts).
		if (parsed.type === BATCH_STEP_TYPE) {
			this.#handleBatchStep(parsed)
			return
		}

		// Readback: scene-graph state, layer hierarchy, single-frame snapshot.
		// These ride the same /post queue as `script` because Cavalry's WebServer
		// exposes no other path — see Introspect.ts for why.
		if (parsed.type === STATE_TYPE || parsed.type === LAYERS_TYPE) {
			this.#handleReadback(parsed.type === STATE_TYPE ? 'state' : 'layers', parsed)
			return
		}
		if (parsed.type === SNAPSHOT_TYPE) {
			this.#handleSnapshot(parsed)
			return
		}
		if (parsed.type === SNAPSHOT_BATCH_TYPE) {
			this.#handleSnapshotBatch(parsed)
			return
		}
		if (parsed.type === BATCH_INSPECT_TYPE) {
			this.#handleBatchInspect(parsed)
			return
		}
		if (parsed.type === EXPORT_COMP_RIG_OVERRIDES_TYPE) {
			this.#handleExportCompRigOverrides(parsed)
			return
		}
		if (parsed.type === CHECKPOINT_TYPE) {
			this.#handleCheckpoint(parsed)
			return
		}
		if (parsed.type === ROLLBACK_TYPE) {
			this.#handleRollback(parsed)
			return
		}
		if (parsed.type === RENDER_FRAME_FAST_TYPE) {
			this.#handleRenderFrameFast(parsed)
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
				const body =
					parsed.helpers === true && !code.includes('const _mg')
						? `${mgHelpersPreamble(MG_HELPERS_SOURCE)}\n${code}`
						: code
				const success = api.exec(
					SCRIPT_ID,
					this.#wrapped(body, seq, statePath, {
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
				// 2.8 returns a string, and an attribute with no input is "" rather than
				// null — an empty string read back after connect() is a dead connection.
				// The array branch stays for hosts that answer with a list.
				var dead = link === null || link === undefined || link === '' || (Array.isArray(link) && link.length === 0);
				if (dead) __diag.failedConnections.push(String(srcId) + ':' + String(srcAttr) + '->' + String(dstId) + ':' + String(dstAttr));
				return result;
			};
		} catch (e) { __consoleLog.push({ level: 'warn', text: 'Stallion: api.connect probe unavailable' }); }
	}
})();`
				: ''
		return `(function () {
// seq is caller-controlled and may be reused; telemetry must be per invocation.
try { globalThis.__stallionState = undefined; } catch (e) {}
var __apiSetDescriptor = Object.getOwnPropertyDescriptor(api, 'set');
var __apiConnectDescriptor = Object.getOwnPropertyDescriptor(api, 'connect');
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
	try { if (__apiSetDescriptor) Object.defineProperty(api, 'set', __apiSetDescriptor); else delete api.set; } catch (e) {}
	try { if (__apiConnectDescriptor) Object.defineProperty(api, 'connect', __apiConnectDescriptor); else delete api.connect; } catch (e) {}
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
	/**
	 * Structured readback of the active composition: layer hierarchy, deterministic
	 * semantic IDs, world-space bounding boxes and attribute values evaluated at the
	 * requested frame. `state` and `layers` share the runtime and differ only in the
	 * `kind` they report, so a caller can ask for the cheap thing (the list) without
	 * paying for the expensive thing (every attribute).
	 *
	 * Executed through `#wrapped` with the atomic marker: the result is delivered by
	 * both channels (globalThis stash and loopback POST) exactly like a script, and no
	 * undo group is opened, because reading must not create an undo step.
	 */
	#handleReadback = (kind: 'state' | 'layers', parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const job: ReadbackJob = normalizeReadbackJob(kind, parsed as Record<string, unknown>)
		const success = api.exec(SCRIPT_ID, this.#wrapped(readbackScript(job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(kind, ERROR_CODES.EXEC_FAILED, `${kind} readback failed to execute in the Cavalry script host.`, { seq, mgCall }))
			console.error(`Stallion: ${kind} readback failed to execute`)
			return
		}
	}

	/**
	 * Single-frame snapshot loopback: render one frame to disk and report the path,
	 * the wall-clock it finished, the byte size read back in the same call, and a
	 * digest of the scene as it was at that frame. This is what removes blind disk
	 * polling from the render-verify-refine loop.
	 *
	 * Cavalry's script host cannot return the PNG bytes, so `file` is the verification
	 * target and the caller reads it over localhost. The mock bridge, which is real
	 * Node, additionally serves an inline base64 buffer.
	 */
	#handleSnapshot = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const normalized = normalizeSnapshotJob(parsed as Record<string, unknown>)
		if ('error' in normalized) {
			this.#serve(errorEnvelope(SNAPSHOT_TYPE, normalized.code, normalized.error, { seq, mgCall }))
			console.error(`Stallion: snapshot rejected — ${normalized.error}`)
			return
		}
		const job: SnapshotJob = normalized.job
		const success = api.exec(SCRIPT_ID, this.#wrapped(snapshotScript(job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind: SNAPSHOT_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(SNAPSHOT_TYPE, ERROR_CODES.EXEC_FAILED, 'Snapshot script failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: snapshot script failed to execute')
			return
		}
	}

	/**
	 * Multi-frame snapshot loopback: one host call renders every critical frame
	 * and returns the per-frame file, verification fields and evaluated layer
	 * boxes. This is the only render path Stage 5 needs; a per-frame loop here
	 * would multiply the host round trips by the beat count.
	 */
	#handleSnapshotBatch = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const normalized = normalizeSnapshotBatchJob(parsed as Record<string, unknown>)
		if ('error' in normalized) {
			this.#serve(errorEnvelope(SNAPSHOT_BATCH_TYPE, normalized.code, normalized.error, { seq, mgCall }))
			console.error(`Stallion: snapshot-batch rejected — ${normalized.error}`)
			return
		}
		const job: SnapshotBatchJob = normalized.job
		const success = api.exec(SCRIPT_ID, this.#wrapped(snapshotBatchScript(job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind: SNAPSHOT_BATCH_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(SNAPSHOT_BATCH_TYPE, ERROR_CODES.EXEC_FAILED, 'Snapshot-batch script failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: snapshot-batch script failed to execute')
			return
		}
	}

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

	/**
	 * Atomic batch-step: execute the script/manifest, sample the requested
	 * frames, render optional PNGs and report the compact DOM — all in one
	 * `api.exec` call (see BatchStep.ts). Runs through `#wrapped` WITHOUT the
	 * atomic marker so the whole batch is one Undo group and the created-layer
	 * telemetry covers the manifest's layers; `sampleFrames` double as the
	 * receipt's beatFrames.
	 */
	#handleBatchEvalAndCapture = (parsed: PostPayload): void => {
		const request = parsed as unknown as Record<string, unknown>
		const normalized = normalizeBatchEvalAndCaptureJob(request)
		if ('error' in normalized) {
			this.#serve(normalized.error)
			return
		}
		const job = normalized.job
		// A reused/omitted seq must never match the previous transaction's stash.
		delete (globalThis as unknown as Record<string, unknown>)[RESULT_STASH]
		try {
			const success = api.exec(SCRIPT_ID, batchEvalAndCaptureScript(job, {
				origin: `http://${this.#config.host}:${this.#config.port}`, token: this.#config.token,
			}))
			if (!success) this.#serve(batchCaptureFailure(request, 'Batch script failed to execute in the Cavalry script host.'))
			else this.#serveStashed(job.seq)
		} catch (err) {
			this.#serve(batchCaptureFailure(request, String(err)))
		}
	}

	#handleBatchStep = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const normalized = normalizeBatchStepJob(parsed as Record<string, unknown>)
		if ('error' in normalized) {
			this.#serve(errorEnvelope(BATCH_STEP_TYPE, normalized.error.code, normalized.error.error, { seq, mgCall }))
			console.error(`Stallion: batch-step rejected — ${normalized.error.error}`)
			return
		}
		const job = normalized.job
		const success = api.exec(
			SCRIPT_ID,
			this.#wrapped(batchStepScript(job, MG_HELPERS_SOURCE, MG_MANIFEST_RUNTIME), seq, undefined, {
				beatFrames: job.frames,
				diagnostics: true,
			}),
		)
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind: BATCH_STEP_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(BATCH_STEP_TYPE, ERROR_CODES.EXEC_FAILED, 'Batch-step script failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: batch-step script failed to execute')
			return
		}
		console.log('Stallion: batch-step executed')
	}

	/**
	 * `/batch_inspect` — geometry-only multi-frame readback matrix (see
	 * BatchInspect.ts). No pixels, one host call, playhead restored once; this
	 * is the endpoint Stage 4.5's local solver polls while it converges.
	 */
	#handleBatchInspect = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const normalized = normalizeBatchInspectJob(parsed as Record<string, unknown>)
		if ('error' in normalized) {
			this.#serve(errorEnvelope(BATCH_INSPECT_TYPE, normalized.error.code, normalized.error.error, { seq, mgCall }))
			console.error(`Stallion: batch_inspect rejected — ${normalized.error.error}`)
			return
		}
		const success = api.exec(SCRIPT_ID, this.#wrapped(batchInspectScript(normalized.job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind: BATCH_INSPECT_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(BATCH_INSPECT_TYPE, ERROR_CODES.EXEC_FAILED, 'batch_inspect failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: batch_inspect failed to execute')
		}
	}

	/**
	 * `/export_comp_rig_overrides` — bounded procedural/visual attribute readback
	 * for folding manual UI tweaks back into a cloned style preset (see
	 * ExportCompRigOverrides.ts). Single state read; the playhead is untouched.
	 */
	#handleExportCompRigOverrides = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const normalized = normalizeExportRigOverridesJob(parsed as Record<string, unknown>)
		if ('error' in normalized) {
			this.#serve(errorEnvelope(EXPORT_COMP_RIG_OVERRIDES_TYPE, normalized.error.code, normalized.error.error, { seq, mgCall }))
			console.error(`Stallion: export_comp_rig_overrides rejected — ${normalized.error.error}`)
			return
		}
		const success = api.exec(SCRIPT_ID, this.#wrapped(exportCompRigOverridesScript(normalized.job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind: EXPORT_COMP_RIG_OVERRIDES_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(EXPORT_COMP_RIG_OVERRIDES_TYPE, ERROR_CODES.EXEC_FAILED, 'export_comp_rig_overrides failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: export_comp_rig_overrides failed to execute')
		}
	}

	/**
	 * `/checkpoint` — serialize the managed layers' state under a snapshotId
	 * (see Checkpoint.ts). The state lands in two places: the in-memory map
	 * below (millisecond rollback) and a temp-file copy the script itself
	 * wrote, so a host restart cannot orphan a snapshotId.
	 */
	#handleCheckpoint = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const job = normalizeCheckpointJob(parsed as Record<string, unknown>).job
		const success = api.exec(SCRIPT_ID, this.#wrapped(checkpointScript(job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			const state = inner.state as CheckpointStateDoc | undefined
			if (doc.ok !== false && inner.ok !== false && state && typeof state === 'object') {
				this.#checkpoints.set(job.snapshotId, {
					capturedAt: Date.now(),
					state,
					tmpFile: typeof inner.tmpFile === 'string' ? inner.tmpFile : null,
				})
				// Bounded store: a checkpoint is a working-set scratch, not a log.
				while (this.#checkpoints.size > 32) {
					const oldest = this.#checkpoints.keys().next().value
					if (oldest === undefined) break
					this.#checkpoints.delete(oldest)
				}
			}
			return { ...inner, seq: doc.seq, kind: CHECKPOINT_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(CHECKPOINT_TYPE, ERROR_CODES.EXEC_FAILED, 'checkpoint failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: checkpoint failed to execute')
		}
	}

	/**
	 * `/rollback` — restore a checkpoint by `snapshotId` (in-memory map first,
	 * then the temp-file copy the checkpoint wrote), or by an inline `state`
	 * document for callers that kept it themselves. One host call.
	 */
	#handleRollback = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		let state = (parsed.state ?? null) as CheckpointStateDoc | null
		const snapshotId = typeof parsed.snapshotId === 'string' ? parsed.snapshotId.trim() : ''
		if (!state && snapshotId) {
			const stored = this.#checkpoints.get(snapshotId)
			if (stored) {
				state = stored.state
			} else {
				// Temp-file fallback: same deterministic path the checkpoint wrote.
				const safeId = snapshotId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
				const tmpFile = `${safe(() => String(api.getTempFolder())) ?? ''}/stallion-checkpoint-${safeId}.cv`
				const raw = safe(() => (tmpFile ? (api.readFromFile(tmpFile) as string) : '')) ?? ''
				const parsedState = safe(() => JSON.parse(raw)) as CheckpointStateDoc | null
				if (parsedState && typeof parsedState === 'object' && Array.isArray(parsedState.layers)) state = parsedState
			}
		}
		if (!state) {
			this.#serve(
				errorEnvelope(
					ROLLBACK_TYPE,
					'STALLION_UNKNOWN_SNAPSHOT',
					`rollback cannot resolve ${snapshotId ? `snapshotId '${snapshotId}'` : 'the request'}: no in-memory checkpoint, no temp-file copy, and no inline \`state\`.`,
					{ seq, mgCall },
				),
			)
			console.error('Stallion: rollback rejected — unknown snapshot')
			return
		}
		const normalized = normalizeRollbackJob({ ...(parsed as Record<string, unknown>), state })
		if ('error' in normalized) {
			this.#serve(errorEnvelope(ROLLBACK_TYPE, normalized.error.code, normalized.error.error, { seq, mgCall }))
			console.error(`Stallion: rollback rejected — ${normalized.error.error}`)
			return
		}
		const success = api.exec(SCRIPT_ID, this.#wrapped(rollbackScript(normalized.job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			return { ...inner, seq: doc.seq, kind: ROLLBACK_TYPE, ok: doc.ok === true && inner.ok !== false }
		})
		if (!success) {
			this.#serve(errorEnvelope(ROLLBACK_TYPE, ERROR_CODES.EXEC_FAILED, 'rollback failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: rollback failed to execute')
		}
	}

	/**
	 * `/render_frame_fast` — one downscaled PNG for the verify loop, written to
	 * the temp directory by default (see RenderFast.ts). The script host has no
	 * binary read, so the live bridge cannot inline the bytes: an `inline`
	 * request is acknowledged with the fast local file path plus a note, and
	 * the mock bridge is the surface that returns `pngBase64`.
	 */
	#handleRenderFrameFast = (parsed: PostPayload): void => {
		const seq = parsed.seq
		const mgCall = typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined
		const tempDir = safe(() => String(api.getTempFolder())) ?? ''
		const normalized = normalizeRenderFrameFastJob(parsed as Record<string, unknown>, tempDir)
		if ('error' in normalized) {
			this.#serve(errorEnvelope(RENDER_FRAME_FAST_TYPE, normalized.error.code, normalized.error.error, { seq, mgCall }))
			console.error(`Stallion: render_frame_fast rejected — ${normalized.error.error}`)
			return
		}
		const job = normalized.job
		const success = api.exec(SCRIPT_ID, this.#wrapped(renderFrameFastScript(job), seq))
		this.#serveReshaped(seq, (doc) => {
			const inner = typeof doc.result === 'object' && doc.result !== null ? (doc.result as Record<string, unknown>) : {}
			const envelope: Record<string, unknown> = { ...inner, seq: doc.seq, kind: RENDER_FRAME_FAST_TYPE, ok: doc.ok === true && inner.ok !== false }
			if (envelope.ok === true && job.inline && typeof envelope.file === 'string') {
				envelope.inline = false
				envelope.inlineNote =
					'The live script host has no binary read; pngBase64 is unavailable here. The file is a fast local temp path — read it over localhost, or point STALLION_URL at a mock bridge for inline buffers.'
			}
			return envelope
		})
		if (!success) {
			this.#serve(errorEnvelope(RENDER_FRAME_FAST_TYPE, ERROR_CODES.EXEC_FAILED, 'render_frame_fast failed to execute in the Cavalry script host.', { seq, mgCall }))
			console.error('Stallion: render_frame_fast failed to execute')
		}
	}
}

/**
 * Preamble for `helpers: true` script posts: define `_mg`/`_rb` in the
 * script's scope from the startup preload when it exists in this context, or
 * from the vendored source when it does not. The user body then runs with
 * `_mg` bound as a parameter-shaped local, so compact `_mg` calls arrive
 * without the helper library travelling over HTTP on every request.
 *
 * Only `globalThis._mg` is checked here (never a bare `_mg`): the `var _mg`
 * below hoists to the script scope and would shadow a global binding of the
 * same name inside any `typeof _mg` check. Exported because the mock bridge
 * must inject the identical preamble (mock-server.test.mjs pins both paths to
 * the same wire contract).
 */
export function mgHelpersPreamble(mgRuntimeSource: string): string {
	return `var __mgEnv = (function () {
	var __g = typeof globalThis !== 'undefined' ? globalThis : this;
	try {
		if (__g._mg && typeof __g._mg.shape === 'function') return { mg: __g._mg, rb: __g._rb || null };
	} catch (e) {}
	${mgRuntimeSource}
	try { __g._mg = _mg; __g._rb = _rb; } catch (e) {}
	return { mg: _mg, rb: _rb };
})();
var _mg = __mgEnv.mg;
var _rb = __mgEnv.rb;`
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
