/** One POST /post transaction; GET /get carries the same envelope in both realms. */
export const BATCH_EVAL_AND_CAPTURE_TYPE = 'batchEvalAndCapture'
export const BATCH_EVAL_LIMITS = { frames: 64, ids: 200, code: 512_000 } as const

export interface BatchEvalAndCaptureRequest {
	type: typeof BATCH_EVAL_AND_CAPTURE_TYPE
	transactionId: string
	undoGroupName: string
	code: string
	sampleFrames: number[]
	/** Logical aliases registered by this transaction, never raw IDs or old aliases. */
	inspectLayerIds: string[]
	renderConfig?: { enabled: boolean; outputDir: string; scaleFactor?: number }
	rollbackOnError?: boolean
	/**
	 * Explicit rollback contract. `undo` (default) requires api.undo + grouping.
	 * `checkpoint` requires saveSceneAs/openScene and a clean (saved or blank)
	 * scene; it saves a full-scene checkpoint BEFORE mutation and restores it
	 * with openScene on failure. No silent fallback between strategies.
	 */
	rollbackStrategy?: 'undo' | 'checkpoint'
	/** Required for `checkpoint`; a fresh .cv path that must not already exist. */
	checkpointPath?: string
	seq?: unknown
}

export interface BatchCaptureError {
	message: string
	line?: number
	stack?: string
}

export interface BatchCaptureCompInfo {
	/** Null only when a failed request could not read composition metadata. */
	width: number | null
	height: number | null
	fps: number | null
	startFrame: number | null
	endFrame: number | null
}

export interface BatchCaptureFrame {
	renderedPngPath?: string
	layerMetrics: Record<string, {
		bbox: { x: number; y: number; width: number; height: number; centreX: number; centreY: number }
		worldTransform: { posX: number; posY: number; scaleX: number; scaleY: number; rotation: number; opacity: number }
	}>
}

export interface BatchEvalAndCaptureResponse {
	kind: typeof BATCH_EVAL_AND_CAPTURE_TYPE
	seq: unknown
	ok: boolean
	transactionId: string
	executionTimeMs: number
	compInfo: BatchCaptureCompInfo
	frames: Record<string, BatchCaptureFrame>
	layerMap?: Record<string, string>
	/** The wire field is named worldTransform, but the documented reads are local. */
	transformSpace?: 'local'
	transformNote?: string
	/** Echo of the executed rollback contract; absent on pre-validation failures. */
	rollbackStrategy?: 'undo' | 'checkpoint'
	/** Checkpoint evidence when rollbackStrategy is `checkpoint`. */
	checkpoint?: {
		path: string
		saved: boolean
		/** Scene path reported before the checkpoint save (may be empty/untitled). */
		originalScenePath?: string
		/** Scene path reported right after the checkpoint save. */
		scenePathAfterSave?: string
		/**
		 * True only after the post-batch commit save landed a real file. A
		 * successful batch leaves the session dirty (mutations after the
		 * checkpoint save); the commit gives the next transaction the clean
		 * scene its save/openScene guard requires. Never set on failure.
		 */
		committed?: boolean
		/** Fresh sibling of `path` holding the committed (post-batch) scene. */
		commitPath?: string
		scenePathAfterCommit?: string
		/** True only after openScene restored the checkpoint and reported its path. */
		restored?: boolean
		scenePathAfterRestore?: string
		/** True when a failed batch could not verify restoration; reconcile manually. */
		sceneStateUnknown?: boolean
	}
	error?: BatchCaptureError
}

export function batchCaptureFailure(parsed: Record<string, unknown>, message: string): BatchEvalAndCaptureResponse {
	return {
		kind: BATCH_EVAL_AND_CAPTURE_TYPE, seq: parsed.seq ?? null, ok: false,
		transactionId: typeof parsed.transactionId === 'string' ? parsed.transactionId : '',
		executionTimeMs: 0,
		compInfo: { width: null, height: null, fps: null, startFrame: null, endFrame: null },
		frames: {}, error: { message },
	}
}

/** Strict validation: reject oversized/malformed inputs, never truncate or coerce. */
export function normalizeBatchEvalAndCaptureJob(parsed: Record<string, unknown>):
	{ job: BatchEvalAndCaptureRequest } | { error: BatchEvalAndCaptureResponse } {
	const bad = (message: string) => ({ error: batchCaptureFailure(parsed, message) })
	const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && !v.includes('\0')
	if (parsed.type !== BATCH_EVAL_AND_CAPTURE_TYPE) return bad('Invalid batchEvalAndCapture type.')
	if (!text(parsed.transactionId)) return bad('transactionId must be a non-empty string.')
	if (!text(parsed.undoGroupName)) return bad('undoGroupName must be a non-empty string.')
	if (typeof parsed.code !== 'string' || parsed.code.length > BATCH_EVAL_LIMITS.code) return bad('code must be a string of at most 512000 characters.')
	if (!Array.isArray(parsed.sampleFrames) || parsed.sampleFrames.length > BATCH_EVAL_LIMITS.frames ||
		parsed.sampleFrames.some((f) => typeof f !== 'number' || !Number.isSafeInteger(f) || Math.abs(f) > 1e9)) {
		return bad('sampleFrames must contain at most 64 integer frames within +/-1000000000.')
	}
	if (!Array.isArray(parsed.inspectLayerIds) || parsed.inspectLayerIds.length > BATCH_EVAL_LIMITS.ids || !parsed.inspectLayerIds.every(text)) {
		return bad('inspectLayerIds must contain at most 200 non-empty logical aliases.')
	}
	if (parsed.inspectLayerIds.length && !parsed.sampleFrames.length) return bad('Inspection requires at least one sample frame.')
	if (parsed.rollbackOnError !== undefined && typeof parsed.rollbackOnError !== 'boolean') return bad('rollbackOnError must be boolean.')
	if (parsed.rollbackStrategy !== undefined && parsed.rollbackStrategy !== 'undo' && parsed.rollbackStrategy !== 'checkpoint') {
		return bad('rollbackStrategy must be "undo" or "checkpoint".')
	}
	const strategy = (parsed.rollbackStrategy as 'undo' | 'checkpoint' | undefined) ?? 'undo'
	let checkpointPath: string | undefined
	if (strategy === 'checkpoint') {
		if (parsed.rollbackOnError !== true) return bad('rollbackStrategy "checkpoint" requires rollbackOnError: true.')
		if (!text(parsed.checkpointPath)) return bad('rollbackStrategy "checkpoint" requires a non-empty checkpointPath.')
		checkpointPath = (parsed.checkpointPath as string).replace(/\\/g, '/')
		if (!checkpointPath.toLowerCase().endsWith('.cv')) return bad('checkpointPath must name a .cv scene file.')
	} else if (parsed.checkpointPath !== undefined) {
		return bad('checkpointPath is only valid with rollbackStrategy "checkpoint".')
	}
	let renderConfig: BatchEvalAndCaptureRequest['renderConfig']
	if (parsed.renderConfig !== undefined) {
		const r = parsed.renderConfig as Record<string, unknown>
		if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.enabled !== 'boolean' || typeof r.outputDir !== 'string' || r.outputDir.includes('\0')) {
			return bad('renderConfig requires enabled:boolean and outputDir:string.')
		}
		// This matches the documented host percentage range without silently clamping.
		if (r.scaleFactor !== undefined && (typeof r.scaleFactor !== 'number' || !Number.isFinite(r.scaleFactor) || r.scaleFactor < 0.01 || r.scaleFactor > 4)) {
			return bad('renderConfig.scaleFactor must be between 0.01 and 4.')
		}
		if (r.enabled && (!text(r.outputDir) || !parsed.sampleFrames.length)) return bad('Rendering requires outputDir and at least one sample frame.')
		renderConfig = { enabled: r.enabled, outputDir: r.outputDir.replace(/\\/g, '/'), scaleFactor: (r.scaleFactor as number | undefined) ?? 1 }
	}
	return { job: {
		type: BATCH_EVAL_AND_CAPTURE_TYPE, transactionId: parsed.transactionId, undoGroupName: parsed.undoGroupName,
		code: parsed.code, sampleFrames: [...new Set(parsed.sampleFrames as number[])],
		inspectLayerIds: [...new Set(parsed.inspectLayerIds as string[])], renderConfig,
		rollbackOnError: parsed.rollbackOnError === true, rollbackStrategy: strategy, checkpointPath, seq: parsed.seq ?? null,
	} }
}

/** Deliberately structural: undo is NOT declared as a verified Cavalry API. */
interface CaptureApi {
	getActiveComp(): string
	setActiveComp(id: string): unknown
	getFrame(): number
	setFrame(frame: number): unknown
	get(id: string, attr: string): unknown
	getInFrame(id: string): number
	getOutFrame(id: string): number
	getBoundingBox(id: string, world: boolean): unknown
	startUndoGroup(name: string): unknown
	endUndoGroup(): unknown
	undo?: () => unknown
	/** Checkpoint strategy only; verified present on Cavalry 2.8.0 by live probe. */
	saveSceneAs?(path: string): unknown
	openScene?(path: string, discardUnsaved?: boolean): unknown
	getSceneFilePath?(): unknown
	sceneHasUnsavedChanges?(): unknown
	renderPNGFrame(path: string, scalePercent: number): unknown
	filePathExists(path: string): boolean
	getFileSize(path: string): number
	makeFolder(path: string): unknown
}

/**
 * Self-contained because its compiled source is injected into api.exec (also in CI).
 * This is isolation for cooperative synchronous scripts, not a security sandbox:
 * arbitrary JS cannot be prevented from mutating shared objects or deleting a comp.
 */
function runBatchEvalAndCapture(job: BatchEvalAndCaptureRequest, host: CaptureApi): BatchEvalAndCaptureResponse {
	const started = Date.now()
	const out: BatchEvalAndCaptureResponse = {
		kind: 'batchEvalAndCapture', seq: job.seq ?? null, transactionId: job.transactionId,
		ok: true, executionTimeMs: 0,
		compInfo: { width: null, height: null, fps: null, startFrame: null, endFrame: null },
		frames: Object.create(null), transformSpace: 'local',
		transformNote: 'bbox is world-space; worldTransform contains evaluated local position/scale/rotation/opacity (no verified world-transform API; rotation is the z spin of the {x,y,z} vector Cavalry 2.8 returns).',
	}
	const fail = (err: unknown) => {
		const e = err as { message?: unknown; stack?: unknown; lineNumber?: unknown; line?: unknown }
		const message = String(e?.message ?? err)
		if (out.error) out.error.message += '; ' + message
		else {
			out.error = { message }
			if (typeof e?.stack === 'string') out.error.stack = e.stack
			const line = e?.lineNumber ?? e?.line
			if (typeof line === 'number' && Number.isFinite(line)) out.error.line = line
		}
		out.ok = false
	}
	const attempt = (fn: () => unknown) => { try { fn() } catch (e) { fail(e) } }
	const number = (value: unknown, label: string): number => {
		if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Missing/non-finite metric: ' + label)
		return value
	}
	const pair = (value: unknown, label: string): [number, number] => {
		const v = value as { x?: unknown; y?: unknown }
		return [number(Array.isArray(v) ? v[0] : v?.x, label + '.x'), number(Array.isArray(v) ? v[1] : v?.y, label + '.y')]
	}
	// Cavalry 2.8 returns {x,y,z} for the rotation attribute even on flat layers
	// (has3dTransforms false; live probe: setting rotation 50 reads {x:0,y:0,z:50}).
	// The viewport spin is the z component.
	const rotation = (value: unknown, label: string): number => {
		if (Array.isArray(value)) return number(value[2], label + '.z')
		if (value && typeof value === 'object') return number((value as { z?: unknown }).z, label + '.z')
		return number(value, label)
	}
	const compInfo = (id: string): BatchCaptureCompInfo => {
		if (!id) throw new Error('No active composition.')
		const res = pair(host.get(id, 'resolution'), 'resolution')
		let start: unknown, end: unknown
		try { start = host.get(id, 'startFrame') } catch { /* older host: use in/out */ }
		try { end = host.get(id, 'endFrame') } catch { /* older host: use in/out */ }
		return { width: res[0], height: res[1], fps: number(host.get(id, 'fps'), 'fps'),
			startFrame: number(start ?? host.getInFrame(id), 'startFrame'), endFrame: number(end ?? host.getOutFrame(id), 'endFrame') }
	}
	const g = globalThis as unknown as Record<string, unknown>
	const strategy = job.rollbackStrategy ?? 'undo'
	out.rollbackStrategy = strategy
	let globals: PropertyDescriptorMap | undefined
	const apiSaved: PropertyDescriptorMap = Object.create(null)
	let previousComp: string | undefined, previousFrame: number | undefined
	let opened = false, closed = false, checkpointSaved = false
	const endGroup = host.endUndoGroup
	const undo = host.undo
	const restoreView = () => {
		// Switching compositions can reset the playhead: restore comp FIRST.
		if (previousComp !== undefined) attempt(() => { if (host.getActiveComp() !== previousComp) host.setActiveComp(previousComp) })
		if (previousFrame !== undefined) attempt(() => { if (host.getFrame() !== previousFrame) host.setFrame(previousFrame) })
	}
	try {
		if (job.rollbackOnError && strategy === 'undo' && typeof undo !== 'function') throw new Error('Unsupported rollback: api.undo is unavailable/unverified; no checkpoint fallback is used.')
		if (strategy === 'checkpoint') {
			if (typeof host.saveSceneAs !== 'function' || typeof host.openScene !== 'function' ||
				typeof host.getSceneFilePath !== 'function' || typeof host.sceneHasUnsavedChanges !== 'function' ||
				typeof host.filePathExists !== 'function' || typeof host.getFileSize !== 'function') {
				throw new Error('Checkpoint rollback is unavailable: saveSceneAs/openScene/getSceneFilePath/sceneHasUnsavedChanges and file verification are required.')
			}
		} else if (typeof host.startUndoGroup !== 'function' || typeof endGroup !== 'function') throw new Error('Undo grouping is unavailable.')
		if (job.renderConfig?.enabled && (typeof host.renderPNGFrame !== 'function' || typeof host.filePathExists !== 'function' || typeof host.getFileSize !== 'function')) {
			throw new Error('PNG rendering/file verification is unavailable.')
		}
		// Compile before any mutation, including opening the group. User declarations
		// stay in their own function; __result assignments and return both work.
		const evaluate = new Function('api', 'var __result; var returned = (function () {\n' + job.code + '\n})(); return typeof __result !== "undefined" ? __result : (typeof globalThis.__result !== "undefined" ? globalThis.__result : returned);')
		if (strategy === 'checkpoint') {
			// Full-scene save/openScene isolation for hosts without api.undo. Guarded
			// to clean scenes (saved or blank): opening the checkpoint later must
			// never discard unsaved user work. The save itself is the pre-live-work
			// scene preservation; a failed restore is reported, never hidden.
			const cp = job.checkpointPath as string
			out.checkpoint = { path: cp, saved: false, committed: false }
			if (host.sceneHasUnsavedChanges!()) throw new Error('Checkpoint rollback requires a clean scene (saved or blank); save the scene before live work.')
			if (host.filePathExists(cp)) throw new Error('Checkpoint path already exists; refusing to overwrite: ' + cp)
			out.checkpoint.originalScenePath = String(host.getSceneFilePath!() ?? '')
			if (host.saveSceneAs!(cp) !== true) throw new Error('saveSceneAs did not confirm the checkpoint save.')
			if (!host.filePathExists(cp) || !(host.getFileSize(cp) > 0)) throw new Error('Checkpoint save produced no file: ' + cp)
			checkpointSaved = true
			out.checkpoint.saved = true
			out.checkpoint.scenePathAfterSave = String(host.getSceneFilePath!() ?? '')
		}
		previousComp = host.getActiveComp()
		previousFrame = number(host.getFrame(), 'original frame')
		out.compInfo = compInfo(previousComp)
		globals = Object.getOwnPropertyDescriptors(g)
		g.__refcloneLayerMap = Object.create(null)
		g.__result = undefined
		g.__stallionState = undefined
		g.__stallionResult__ = undefined
		// Restore probes/user replacements even on throw, without converting inherited
		// methods into permanent own properties on the Node mock.
		for (const key of ['set', 'connect', 'startUndoGroup', 'endUndoGroup']) {
			apiSaved[key] = Object.getOwnPropertyDescriptor(host, key)
		}
		if (strategy === 'undo') {
			const startGroup = host.startUndoGroup
			const groupOwned = () => { throw new Error('The transaction owns its single undo group; code must not open/close groups.') }
			host.startUndoGroup = groupOwned
			host.endUndoGroup = groupOwned
			startGroup.call(host, job.undoGroupName)
			opened = true
		}
		try {
			const result = evaluate(host)
			// Explicitly reject non-serialisable and async results, not silent success.
			if (result && typeof result.then === 'function') throw new Error('Asynchronous batch code is unsupported.')
			try { JSON.stringify(result) } catch { throw new Error('Script result was not serialisable.') }
			const check = (r: unknown): void => {
				if (!r || typeof r !== 'object') return
				const doc = r as Record<string, unknown>
				if (doc.ok === false) throw doc.error ?? new Error('Script __result.ok was false.')
				if (doc.result) check(doc.result)
				if (doc.__result) check(doc.__result)
			}
			check(result)
		} finally {
			if (opened) {
				endGroup.call(host)
				closed = true
			}
		}
		// Cavalry may not evaluate created geometry until the group closes.
		out.compInfo = compInfo(host.getActiveComp())
		const map = g.__refcloneLayerMap
		if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('__refcloneLayerMap must be an alias-to-layer-ID object.')
		const layerMap: Record<string, string> = Object.create(null)
		for (const alias of Object.keys(map)) {
			const id = (map as Record<string, unknown>)[alias]
			if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid layer ID for alias: ' + alias)
			layerMap[alias] = id
		}
		out.layerMap = layerMap
		for (const alias of job.inspectLayerIds) {
			if (!Object.prototype.hasOwnProperty.call(layerMap, alias)) throw new Error('Missing inspection alias in current transaction: ' + alias)
		}
		const render = job.renderConfig
		// makeFolder is best-effort: an existing artifacts directory is a normal
		// convergence/re-render case, and overwriteExisting would replace files.
		// The per-frame filePathExists/getFileSize checks below are authoritative.
		if (render?.enabled && typeof host.makeFolder === 'function') {
			try { host.makeFolder(render.outputDir) } catch { /* verify the actual PNGs below */ }
		}
		for (const frame of job.sampleFrames) {
			if (host.setFrame(frame) === false) throw new Error('Could not sample frame ' + frame)
			const entry: BatchCaptureFrame = { layerMetrics: Object.create(null) }
			for (const alias of job.inspectLayerIds) {
				const id = layerMap[alias]
				const bb = host.getBoundingBox(id, true) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown; centre?: { x?: unknown; y?: unknown } }
				if (!bb) throw new Error('Missing bounding box for alias: ' + alias)
				const x = number(bb.x, alias + '.bbox.x'), y = number(bb.y, alias + '.bbox.y')
				const width = number(bb.width, alias + '.bbox.width'), height = number(bb.height, alias + '.bbox.height')
				const pos = pair(host.get(id, 'position'), alias + '.position'), scale = pair(host.get(id, 'scale'), alias + '.scale')
				entry.layerMetrics[alias] = {
					bbox: { x, y, width, height, centreX: number(bb.centre?.x ?? x + width / 2, alias + '.centreX'), centreY: number(bb.centre?.y ?? y + height / 2, alias + '.centreY') },
					worldTransform: { posX: pos[0], posY: pos[1], scaleX: scale[0], scaleY: scale[1],
						rotation: rotation(host.get(id, 'rotation'), alias + '.rotation'), opacity: number(host.get(id, 'opacity'), alias + '.opacity') },
				}
			}
			if (render?.enabled) {
				const stem = render.outputDir.replace(/\/$/, '') + '/frame_' + frame
				if (host.renderPNGFrame(stem, 100 * (render.scaleFactor ?? 1)) === false) throw new Error('PNG render failed at frame ' + frame)
				const file = stem + '.png'
				if (!host.filePathExists(file) || !(host.getFileSize(file) > 0)) throw new Error('PNG render produced no file at frame ' + frame)
				entry.renderedPngPath = file
			}
			out.frames[String(frame)] = entry
		}
		if (strategy === 'checkpoint' && checkpointSaved) {
			// The batch succeeded, but its mutations landed after the checkpoint
			// save, so the session is dirty. The next transaction's clean-scene
			// guard would refuse before it could save its own checkpoint. Commit
			// the post-batch scene to a fresh job-owned sibling of the checkpoint
			// so the session is saved again; the guard itself stays unchanged, so
			// user edits made between transactions still make the scene dirty and
			// are still refused. A failed commit fails the batch and restores the
			// pre-mutation checkpoint below.
			const commitPath = (job.checkpointPath as string).replace(/\.cv$/i, '') + '-committed.cv'
			if (host.filePathExists(commitPath)) throw new Error('Checkpoint commit path already exists; refusing to overwrite: ' + commitPath)
			if (host.saveSceneAs!(commitPath) !== true) throw new Error('saveSceneAs did not confirm the checkpoint commit.')
			if (!host.filePathExists(commitPath) || !(host.getFileSize(commitPath) > 0)) throw new Error('Checkpoint commit produced no file: ' + commitPath)
			out.checkpoint!.committed = true
			out.checkpoint!.commitPath = commitPath
			out.checkpoint!.scenePathAfterCommit = String(host.getSceneFilePath!() ?? '')
		}
	} catch (e) {
		fail(e)
	} finally {
		for (const key of Object.keys(apiSaved)) attempt(() => {
			if (apiSaved[key]) Object.defineProperty(host, key, apiSaved[key])
			else if (!Reflect.deleteProperty(host, key)) throw new Error('Could not restore api.' + key)
		})
		if (globals) {
			// Shallow descriptor restoration preserves preload bindings and removes
			// transient globals; it cannot undo arbitrary mutations inside objects.
			for (const key of Object.getOwnPropertyNames(g)) if (!Object.prototype.hasOwnProperty.call(globals, key)) attempt(() => {
				if (!Reflect.deleteProperty(g, key)) throw new Error('Could not remove transient global ' + key)
			})
			for (const key of Object.keys(globals)) attempt(() => { Object.defineProperty(g, key, globals[key]) })
		}
		restoreView()
		if (!out.ok && job.rollbackOnError) {
			if (strategy === 'undo') {
				if (opened && closed && typeof undo === 'function') {
					attempt(() => { if (undo.call(host) === false) throw new Error('api.undo failed.') })
					restoreView()
				}
			} else if (checkpointSaved) {
				// Restore the pre-mutation scene from the verified checkpoint. The
				// session may remain associated with the checkpoint file; the envelope
				// reports that path honestly instead of silently reopening a file the
				// batch code could have overwritten.
				attempt(() => {
					if (host.openScene!(job.checkpointPath as string, true) === false) throw new Error('openScene refused the checkpoint restore.')
					const reported = String(host.getSceneFilePath!() ?? '').replace(/\\/g, '/')
					if (reported !== (job.checkpointPath as string).replace(/\\/g, '/')) throw new Error('Checkpoint restore reported a different scene path: ' + reported)
					out.checkpoint!.restored = true
					out.checkpoint!.scenePathAfterRestore = reported
				})
				if (out.checkpoint!.restored !== true) {
					out.checkpoint!.restored = false
					out.checkpoint!.sceneStateUnknown = true
				}
				restoreView()
			}
		}
		if (!out.ok) {
			// Never offer a partial capture or rolled-back IDs as a successful batch.
			out.frames = Object.create(null)
			delete out.layerMap
		}
		out.executionTimeMs = Math.max(0, Date.now() - started)
	}
	return out
}

/** No generic #wrapped envelope or #serveReshaped: serialize ONCE for both channels. */
export function batchEvalAndCaptureScript(job: BatchEvalAndCaptureRequest, channel?: { origin: string; token: string }): string {
	return `/* cavalry-mcp:atomic */(function () {
	var response = (${runBatchEvalAndCapture.toString()})(${JSON.stringify(job)}, api);
	var payload = JSON.stringify(response);
	${channel ? `try { globalThis.__stallionResult__ = payload; } catch (e) {}
	try {
		var client = new api.WebClient(${JSON.stringify(channel.origin)});
		${channel.token ? `client.setTokenAuthentication(${JSON.stringify(channel.token)});` : ''}
		client.post('/post', JSON.stringify({ type: '__stallion_result__', batchEvalAndCaptureResult: JSON.parse(payload) }), 'application/json');
	} catch (e) {}` : ''}
	return JSON.parse(payload);
})()`
}
