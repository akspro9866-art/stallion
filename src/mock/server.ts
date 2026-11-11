/**
 * Headless mock Stallion bridge (`--mock`).
 *
 * A dependency-free Node HTTP server that speaks the exact :8080 wire
 * contract — POST /post (script | render-frames | internal loopback), GET
 * /get (status heartbeat | result envelope), optional `seq` matching, Bearer
 * token auth — against an in-memory scene graph instead of a live Cavalry
 * instance. It exists so GitHub Actions CI can run the whole stack:
 *
 *   refclone → cavalry-mcp (injects `_mg`) → stallion --mock → synthetic frames
 *
 * Responses mirror the live bridge shape-for-shape, including the
 * deterministic receipt (sceneStateHash / consoleDiagnostics / beatBBoxes)
 * and the execution snapshot. render-frames additionally serves true inline
 * buffers (base64 png_buffer / raw_rgba) which the live bridge cannot —
 * Cavalry's scripting host has no binary readback — plus a literal
 * POST /render-frames route that streams raw bytes when the caller asks for
 * application/octet-stream.
 */

import http from 'node:http'
import vm from 'node:vm'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { MockApi, type MockFrameBuffer } from './api.ts'
import { MockScene } from './scene.ts'
import { encodePng, rasterizeFrame } from './raster.ts'
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
} from '../cavalry/modules/Introspect.ts'
import {
	BATCH_STEP_TYPE,
	batchStepScript,
	normalizeBatchStepJob,
} from '../cavalry/modules/BatchStep.ts'
import {
	BATCH_INSPECT_TYPE,
	batchInspectScript,
	normalizeBatchInspectJob,
} from '../cavalry/modules/BatchInspect.ts'
import {
	EXPORT_COMP_RIG_OVERRIDES_TYPE,
	exportCompRigOverridesScript,
	normalizeExportRigOverridesJob,
} from '../cavalry/modules/ExportCompRigOverrides.ts'
import {
	CHECKPOINT_TYPE,
	ROLLBACK_TYPE,
	checkpointScript,
	normalizeCheckpointJob,
	normalizeRollbackJob,
	rollbackScript,
	type CheckpointStateDoc,
} from '../cavalry/modules/Checkpoint.ts'
import { RENDER_FRAME_FAST_TYPE, normalizeRenderFrameFastJob, renderFrameFastScript } from '../cavalry/modules/RenderFast.ts'
import { DETERMINISM_TYPE, normalizeDeterminismJob, runDeterminismCheck } from './determinism.ts'
import { MG_HELPERS_SOURCE, MG_MANIFEST_RUNTIME } from '../cavalry/modules/mgRuntime.ts'
import { mgHelpersPreamble } from '../cavalry/modules/Callbacks.ts'
import {
	BATCH_EVAL_AND_CAPTURE_TYPE,
	batchCaptureFailure,
	batchEvalAndCaptureScript,
	normalizeBatchEvalAndCaptureJob,
} from '../cavalry/modules/BatchEvalAndCapture.ts'
import { executeOnMock } from './execute.ts'
import { bearerOk, readBody } from './http-utils.ts'
import { introspectQuery, inlineWanted } from './query.ts'
import {
	buildReceipt,
	captureJsLogDiagnostics,
	isExpressionPayloadType,
	payloadTypeToExecutionContext,
	validateCavalryContextUsage,
	validateSkslSource,
	type ConsoleEntry,
	type ExpressionPayloadType,
	type ExpressionReceipt,
} from './receipt.ts'
import { ASTRYX_THEME_NAMES, resolveAstryxTheme } from '../themes/astryx-themes.ts'
import { validateMgPurity, injectSceneThemeInsideUndo } from '../validation/validate-mg-purity.ts'

// Moved to execute.ts; re-exported to keep the original public path.
export { executeOnMock } from './execute.ts'
// Vision-free scene lint (contrast / overlap / title-safe) re-exported for the
// CLI and for programmatic pre-render gates.
export {
	lintSceneGraph,
	lintSceneGraphAtFrame,
	formatSceneLintReport,
	parseColor,
	contrastRatio,
	relativeLuminance,
	SCENE_LINT_BODY_CONTRAST,
	SCENE_LINT_LARGE_CONTRAST,
	SCENE_LINT_LARGE_TEXT_PX,
	SCENE_LINT_TITLE_SAFE_MARGIN,
	SCENE_LINT_OVERLAP_RATIO,
	SCENE_LINT_SAMPLE_FRACTIONS,
} from './lint.ts'
export type { SceneLintFinding, SceneLintOptions, SceneLintReport, SceneLintRule } from './lint.ts'
export { MockScene } from './scene.ts'
export { MockApi } from './api.ts'
export {
	buildReceipt,
	captureJsLogDiagnostics,
	CAVALRY_EXECUTION_CONTEXTS,
	CONTEXT_GLOBALS_BY_CONTEXT,
	EXPRESSION_PAYLOAD_TYPES,
	isExpressionPayloadType,
	payloadTypeToExecutionContext,
	validateCavalryContextUsage,
	validateSkslSource,
	type CavalryExecutionContext,
	type ConsoleEntry,
	type ExpressionPayloadType,
	type ExpressionReceipt,
} from './receipt.ts'

export const MOCK_VERSION = '0.11.0'

const RESULT_TYPE = '__stallion_result__'
const RENDER_FRAMES_TYPE = 'render-frames'
const MAX_INLINE_FRAMES = 64

export interface MockServerOptions {
	host?: string
	port?: number
	token?: string
	strictSchema?: boolean
	/** Echo captured console output to stderr (debugging aid, off in CI). */
	verbose?: boolean
	/**
	 * Seed ONE persistent vm context with the `_mg`/`_rb` startup preload —
	 * the same shared-context shape a live Cavalry presents after `Scripts →
	 * Stallion`. Every script and batch-step then takes the bridge's preload
	 * branch (`globalThis._mg` present) instead of re-evaluating the vendored
	 * runtime per call, which is what keeps mock and live wire-faithful.
	 */
	preloadMg?: boolean
}

export interface MockServerHandle {
	port: number
	host: string
	scene: MockScene
	api: MockApi
	lastFrames: () => MockFrameBuffer[]
	close: () => Promise<void>
}

export function startMockServer(options: MockServerOptions = {}): Promise<MockServerHandle> {
	const host = options.host ?? process.env.STALLION_HOST ?? '127.0.0.1'
	const requestedPort = options.port ?? (Number(process.env.STALLION_PORT) || 8080)
	const token = options.token ?? process.env.STALLION_TOKEN ?? ''
	const scene = new MockScene({ strictSchema: options.strictSchema !== false })
	const api = new MockApi(scene, {
		render: (s, compId, frame, width, height) => rasterizeFrame(s, compId, frame, width, height),
	})
	let lastPayload: Record<string, unknown> | null = null
	const queue: Promise<void> = Promise.resolve()

	// preloadMg: one persistent vm context carrying the `_mg`/`_rb` startup
	// preload, so scripts and batch-steps run exactly the preload branch a live
	// shared script context takes (see MockServerOptions.preloadMg).
	let persistentContext: vm.Context | null = null
	if (options.preloadMg === true) {
		const seedConsole = {
			log: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		}
		persistentContext = vm.createContext({
			api,
			console: seedConsole,
			__result: undefined,
			__stallionState: undefined,
			cavalry: {
				versionLessThan: () => false,
				Path: class {
					d = ''
					setD(d: string) {
						this.d = String(d)
						return this
					}
				},
			},
		})
		vm.runInContext(mgHelpersPreamble(MG_HELPERS_SOURCE), persistentContext)
	}

	const heartbeat = (): Record<string, unknown> => ({
		kind: 'status',
		stallion: `${MOCK_VERSION}-mock`,
		cavalry: '2.8.0-mock',
		scene: api.getSceneFilePath(),
		frame: scene.frame,
		unSaved: api.sceneHasUnsavedChanges(),
				capabilities: {
					receipt: true,
					renderFrames: true,
					batchEvalAndCapture: true,
					batchEvalAndCaptureRollback: false,
					batchEvalAndCaptureCheckpoint: ['saveSceneAs', 'openScene', 'getSceneFilePath', 'sceneHasUnsavedChanges', 'filePathExists', 'getFileSize']
						.every((key) => typeof (api as unknown as Record<string, unknown>)[key] === 'function'),
					determinismCheck: true,
					// Same shape as the live heartbeat: introspection is a `type` on POST /post,
					// and only the mock additionally answers GET /state, /layers, /frame and the
					// literal POST /batch-step route.
					introspect: ['state', 'layers', 'snapshot', 'snapshot-batch', BATCH_STEP_TYPE, BATCH_INSPECT_TYPE, EXPORT_COMP_RIG_OVERRIDES_TYPE, CHECKPOINT_TYPE, ROLLBACK_TYPE, RENDER_FRAME_FAST_TYPE],
				mgRuntime: true,
				errorEnvelope: 1,
				mock: true,
			},
		ts: Date.now(),
	})

	const serveJson = (response: http.ServerResponse, payload: unknown, status = 200): void => {
		const body = JSON.stringify(payload)
		response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
		response.end(body)
	}

	const handleRenderFrames = async (parsed: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const seq = parsed.seq
		const rawFrames = Array.isArray(parsed.frames) ? parsed.frames : []
		const frames = rawFrames.map((f) => Math.round(Number(f))).filter((f) => Number.isFinite(f))
		if (!frames.length || frames.length > 2_000) {
			return { type: RESULT_TYPE, kind: 'render-frames', seq, ok: false, error: 'render-frames requires 1..2000 frames' }
		}
		const resolutionScale = Number(parsed.resolutionScale)
		const scale = Number.isFinite(resolutionScale) && resolutionScale > 0 ? Math.min(4, Math.max(0.01, resolutionScale)) : 0.5
		const format = parsed.format === 'raw_rgba' ? 'raw_rgba' : 'png_buffer'
		const compId = typeof parsed.compId === 'string' && parsed.compId ? parsed.compId : api.getActiveComp()
		const comp = scene.comps.get(compId)
		if (!comp) return { type: RESULT_TYPE, kind: 'render-frames', seq, ok: false, error: `no comp '${compId}'` }
		const width = Math.max(1, Math.round(comp.width * scale))
		const height = Math.max(1, Math.round(comp.height * scale))
		const outDir = typeof parsed.outDir === 'string' && parsed.outDir.trim() ? path.resolve(parsed.outDir.trim()) : null
		const previousFrame = scene.frame
		const rendered: Array<Record<string, unknown>> = []
		const failed: Array<Record<string, unknown>> = []
		try {
			for (const frame of frames) {
				try {
					scene.frame = frame
					const raster = rasterizeFrame(scene, compId, frame, width, height)
					const entry: Record<string, unknown> = { frame, width: raster.width, height: raster.height }
					if (rendered.length < MAX_INLINE_FRAMES) {
						const png = encodePng(raster.rgba, raster.width, raster.height)
						entry.bytes = format === 'raw_rgba' ? raster.rgba.length : png.length
						entry.bufferBase64 = (format === 'raw_rgba' ? raster.rgba : png).toString('base64')
					} else {
						entry.omitted = 'inline budget exhausted; raise outDir to write files instead'
					}
					if (outDir) {
						fs.mkdirSync(outDir, { recursive: true })
						const padded = String(frame).padStart(6, '0')
						const file = path.join(outDir, `frame-${padded}.png`)
						fs.writeFileSync(file, encodePng(raster.rgba, raster.width, raster.height))
						entry.file = file
					}
					rendered.push(entry)
				} catch (err) {
					failed.push({ frame, error: String((err as Error)?.message ?? err) })
				}
			}
		} finally {
			scene.frame = previousFrame
		}
		return {
			type: RESULT_TYPE,
			kind: 'render-frames',
			seq,
			ok: rendered.length > 0,
			format,
			scale,
			scalePercent: Math.round(scale * 100),
			compId,
			width,
			height,
			rendered,
			failed,
			receipt: buildReceipt(scene, [], [], []),
		}
	}

	/**
	 * Readback and snapshot run the *same* runtime source the live bridge hands to
	 * `api.exec` — `readbackScript` / `snapshotScript` from Introspect.ts — through the
	 * vm sandbox. That is the point: the script that ships inside Cavalry is the script
	 * CI exercises headlessly, so a bug in the walk cannot hide behind a mock that
	 * reimplements it in TypeScript.
	 */
	const runIntrospect = (
		source: string,
		kind: string,
		parsed: Record<string, unknown>,
	): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const ran = executeOnMock(source, api, { verbose: options.verbose, context: persistentContext ?? undefined })
		if (ran.error !== null) {
			return { ...errorEnvelope(kind, ERROR_CODES.EXEC_FAILED, ran.error, { seq, stack: ran.stack ?? undefined }) }
		}
		const inner = typeof ran.result === 'object' && ran.result !== null ? (ran.result as Record<string, unknown>) : {}
		return { type: RESULT_TYPE, kind, seq, ...inner, ok: inner.ok !== false }
	}

	const handleReadbackPost = (kind: 'state' | 'layers', parsed: Record<string, unknown>): Record<string, unknown> => {
		const job = normalizeReadbackJob(kind, parsed)
		return runIntrospect(readbackScript(job), kind, parsed)
	}

	const handleSnapshotPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const normalized = normalizeSnapshotJob(parsed)
		if ('error' in normalized) {
			return errorEnvelope(SNAPSHOT_TYPE, normalized.code, normalized.error, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		const envelope = runIntrospect(snapshotScript(normalized.job), SNAPSHOT_TYPE, parsed)
		// The live host has no crypto and cannot read its own PNG back, so it reports
		// size and a scene digest only. The mock is real Node, so it also reports the
		// content hash — the strongest form of the verification the loop needs.
		if (envelope.ok === true && typeof envelope.file === 'string' && fs.existsSync(envelope.file)) {
			try {
				envelope.contentHash = createHash('sha256').update(fs.readFileSync(envelope.file)).digest('hex')
			} catch {
				/* leave contentHash unset; sizeBytes still stands as evidence */
			}
		}
		return envelope
	}

	const handleSnapshotBatchPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const normalized = normalizeSnapshotBatchJob(parsed)
		if ('error' in normalized) {
			return errorEnvelope(SNAPSHOT_BATCH_TYPE, normalized.code, normalized.error, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		const envelope = runIntrospect(snapshotBatchScript(normalized.job), SNAPSHOT_BATCH_TYPE, parsed)
		const frames = Array.isArray(envelope.frames) ? (envelope.frames as Array<Record<string, unknown>>) : []
		for (const entry of frames) {
			const file = typeof entry.file === 'string' ? entry.file : ''
			if (!file || !fs.existsSync(file)) continue
			try {
				entry.contentHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
			} catch {
				/* sizeBytes remains the verification evidence */
			}
		}
		return envelope
	}

	/**
	 * Batch-step runs the exact `batchStepScript` source the live bridge hands
	 * to `api.exec`, through the same vm sandbox — including the vendored `_mg`
	 * runtime and the `__mgApplyManifest` interpreter, so a `dslManifest` sent
	 * to the mock behaves like one sent to Cavalry.
	 */
	const handleBatchEvalAndCapturePost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const normalized = normalizeBatchEvalAndCaptureJob(parsed)
		if ('error' in normalized) return { ...normalized.error }
		const ran = executeOnMock(batchEvalAndCaptureScript(normalized.job), api, {
			verbose: options.verbose, context: persistentContext ?? undefined,
		})
		if (ran.error !== null) return { ...batchCaptureFailure(parsed, ran.error) }
		return ran.result as Record<string, unknown>
	}

	const handleBatchStepPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const normalized = normalizeBatchStepJob(parsed)
		if ('error' in normalized) {
			return errorEnvelope(BATCH_STEP_TYPE, normalized.error.code, normalized.error.error, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		return runIntrospect(batchStepScript(normalized.job, MG_HELPERS_SOURCE, MG_MANIFEST_RUNTIME), BATCH_STEP_TYPE, parsed)
	}

	// In-memory checkpoint store, mirroring the live bridge: snapshotId → state.
	// The checkpoint script also wrote a temp-file copy, so both surfaces can
	// restore after a process restart the same way.
	const checkpoints = new Map<string, { capturedAt: number; state: CheckpointStateDoc; tmpFile: string | null }>()

	/** Resolve a rollback's state document: inline `state`, then memory, then temp file. */
	const resolveRollbackState = (parsed: Record<string, unknown>): CheckpointStateDoc | null => {
		const inline = parsed.state
		if (inline && typeof inline === 'object' && !Array.isArray(inline) && Array.isArray((inline as CheckpointStateDoc).layers)) {
			return inline as CheckpointStateDoc
		}
		const snapshotId = typeof parsed.snapshotId === 'string' ? parsed.snapshotId.trim() : ''
		if (!snapshotId) return null
		const stored = checkpoints.get(snapshotId)
		if (stored) return stored.state
		const safeId = snapshotId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
		const tmpFile = path.join(api.getTempFolder(), `stallion-checkpoint-${safeId}.cv`)
		try {
			const parsedState = JSON.parse(fs.readFileSync(tmpFile, 'utf8')) as CheckpointStateDoc
			if (parsedState && typeof parsedState === 'object' && Array.isArray(parsedState.layers)) return parsedState
		} catch {
			/* unknown snapshotId */
		}
		return null
	}

	const handleBatchInspectPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const normalized = normalizeBatchInspectJob(parsed)
		if ('error' in normalized) {
			return errorEnvelope(BATCH_INSPECT_TYPE, normalized.error.code, normalized.error.error, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		return runIntrospect(batchInspectScript(normalized.job), BATCH_INSPECT_TYPE, parsed)
	}

	const handleExportCompRigOverridesPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const normalized = normalizeExportRigOverridesJob(parsed)
		if ('error' in normalized) {
			return errorEnvelope(EXPORT_COMP_RIG_OVERRIDES_TYPE, normalized.error.code, normalized.error.error, {
				seq: parsed.seq ?? null,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		return runIntrospect(exportCompRigOverridesScript(normalized.job), EXPORT_COMP_RIG_OVERRIDES_TYPE, parsed)
	}

	const handleCheckpointPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const job = normalizeCheckpointJob(parsed).job
		const envelope = runIntrospect(checkpointScript(job), CHECKPOINT_TYPE, parsed)
		const state = envelope.state as CheckpointStateDoc | undefined
		if (envelope.ok === true && state && typeof state === 'object') {
			checkpoints.set(job.snapshotId, {
				capturedAt: Date.now(),
				state,
				tmpFile: typeof envelope.tmpFile === 'string' ? envelope.tmpFile : null,
			})
			while (checkpoints.size > 32) {
				const oldest = checkpoints.keys().next().value
				if (oldest === undefined) break
				checkpoints.delete(oldest)
			}
		}
		return envelope
	}

	const handleRollbackPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const state = resolveRollbackState(parsed)
		if (!state) {
			const snapshotId = typeof parsed.snapshotId === 'string' ? parsed.snapshotId.trim() : ''
			return errorEnvelope(ROLLBACK_TYPE, 'STALLION_UNKNOWN_SNAPSHOT', `rollback cannot resolve ${snapshotId ? `snapshotId '${snapshotId}'` : 'the request'}: no in-memory checkpoint, no temp-file copy, and no inline \`state\`.`, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		const normalized = normalizeRollbackJob({ ...parsed, state })
		if ('error' in normalized) {
			return errorEnvelope(ROLLBACK_TYPE, normalized.error.code, normalized.error.error, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		return runIntrospect(rollbackScript(normalized.job), ROLLBACK_TYPE, parsed)
	}

	const handleRenderFrameFastPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const normalized = normalizeRenderFrameFastJob(parsed, api.getTempFolder())
		if ('error' in normalized) {
			return errorEnvelope(RENDER_FRAME_FAST_TYPE, normalized.error.code, normalized.error.error, {
				seq: parsed.seq ?? null,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		const envelope = runIntrospect(renderFrameFastScript(normalized.job), RENDER_FRAME_FAST_TYPE, parsed)
		if (envelope.ok !== true) return envelope
		// The mock is real Node: hash the artifact and inline the pixels — the
		// exact contract snapshot serves. The file on disk is the mock's
		// placeholder; the real pixels live in the `.rgba` sidecar, so the inline
		// buffer is a true PNG encoded from it (as applyBatchInline does).
		const file = typeof envelope.file === 'string' ? envelope.file : ''
		if (!file || !fs.existsSync(file)) return envelope
		try {
			envelope.contentHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
			if (normalized.job.inline) {
				const comp = scene.comps.get(String(envelope.compId ?? '')) ?? scene.activeComp()
				const width = Math.max(1, Math.round((comp?.width ?? 0) * normalized.job.scaleFactor))
				const height = Math.max(1, Math.round((comp?.height ?? 0) * normalized.job.scaleFactor))
				const sidecar = `${file}.rgba`
				if (comp && fs.existsSync(sidecar)) {
					const rgba = fs.readFileSync(sidecar)
					if (rgba.length === width * height * 4) {
						envelope.pngBase64 = encodePng(rgba, width, height).toString('base64')
						envelope.width = width
						envelope.height = height
					} else {
						envelope.inlineNote = `sidecar length ${rgba.length} does not match ${width}x${height}x4`
					}
				}
			}
		} catch {
			/* sizeBytes remains the verification evidence */
		}
		return envelope
	}

	/**
	 * determinism-check evaluates a submitted frame function across the 7
	 * evaluation orders in isolated vm sandboxes (the scene is never touched)
	 * and answers with the DeterminismReport plus the standard receipt. The
	 * static lint is the purity gate for this surface: a failed lint makes the
	 * envelope ok:false even when every order agrees, and the 7-order check is
	 * the authority on frame-order state the lint only warns about.
	 */
	const handleDeterminismPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const normalized = normalizeDeterminismJob(parsed)
		if ('error' in normalized) {
			return errorEnvelope(DETERMINISM_TYPE, normalized.code, normalized.error, {
				seq,
				mgCall: typeof parsed.mgCall === 'string' ? parsed.mgCall : undefined,
			})
		}
		const report = runDeterminismCheck(normalized.job)
		const receipt = buildReceipt(scene, report.consoleDiagnostics, [], [])
		return {
			type: RESULT_TYPE,
			kind: DETERMINISM_TYPE,
			seq,
			ok: report.deterministic && report.lint.passed,
			...report,
			receipt,
		}
	}

	const handleScriptPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const rawCode = typeof parsed.code === 'string' ? parsed.code : ''
		const statePath = typeof parsed.statePath === 'string' && parsed.statePath ? parsed.statePath : null
		const pathOnly = typeof parsed.path === 'string' && parsed.path
		if (pathOnly && !rawCode) {
			const exists = fs.existsSync(pathOnly)
			return { type: RESULT_TYPE, kind: 'result', seq, ok: exists, ...(exists ? { note: 'file script executed (no captured result)' } : { error: `No script found at ${pathOnly}` }) }
		}
		if (!rawCode) {
			return { type: RESULT_TYPE, kind: 'result', seq, ok: false, error: 'Missing/empty `code` or `path` key in request' }
		}
		// helpers:true gets the identical preamble the live bridge injects, so a
		// compact `_mg` script behaves the same on both surfaces.
		const code =
			parsed.helpers === true && !rawCode.includes('const _mg')
				? `${mgHelpersPreamble(MG_HELPERS_SOURCE)}\n${rawCode}`
				: rawCode
		const beatFrames = Array.isArray(parsed.beatFrames) ? parsed.beatFrames.map((f) => Math.round(Number(f))).filter((f) => Number.isFinite(f)) : []
		const ran = executeOnMock(code, api, { verbose: options.verbose, context: persistentContext ?? undefined })
		const receiptIds = [
			...new Set([...((ran.state.createdLayerIds as string[]) ?? []), ...((ran.state.activeSelection as string[]) ?? [])]),
		]
		const receipt = buildReceipt(scene, ran.console, receiptIds, beatFrames)
		if (statePath) {
			try {
				fs.mkdirSync(path.dirname(statePath), { recursive: true })
				fs.writeFileSync(statePath, JSON.stringify({ ...ran.state, seq, receipt }))
			} catch {
				// diagnostic write; never fail the execution for it
			}
		}
		const envelope: Record<string, unknown> = { type: RESULT_TYPE, kind: 'result', seq, ok: ran.error === null }
		if (ran.error !== null) {
			envelope.error = ran.error
			envelope.stack = ran.stack
		} else if (typeof ran.result !== 'undefined') {
			envelope.result = ran.result
		}
		envelope.receipt = receipt
		envelope.state = { ...ran.state, seq, receipt }
		return envelope
	}

	const handleExpressionPost = (parsed: Record<string, unknown>): Record<string, unknown> => {
		const seq = parsed.seq ?? null
		const type = typeof parsed.type === 'string' ? parsed.type : ''
		const code = typeof parsed.code === 'string' ? parsed.code : ''
		if (!code) {
			return { type: RESULT_TYPE, kind: 'result', seq, ok: false, error: 'Missing/empty `code` key in request' }
		}
		const beatFrames = Array.isArray(parsed.beatFrames)
			? parsed.beatFrames.map((f) => Math.round(Number(f))).filter((f) => Number.isFinite(f))
			: []
		const applied: string[] = []
		const skipped: string[] = []
		const diagEntries: ConsoleEntry[] = []
		let valid = true
		let uniforms: Array<{ type: string; name: string }> | undefined

		if (type.startsWith('javaScript') || type.startsWith('sksl')) {
			let selection: string[] = []
			if (typeof parsed.targetId === 'string' && parsed.targetId) {
				selection = [parsed.targetId]
			} else if (typeof parsed.layerId === 'string' && parsed.layerId) {
				selection = [parsed.layerId]
			} else {
				selection = api.getSelection()
			}
			if (!selection.length) {
				const layerId = api.create(type)
				selection = [layerId]
			}
			let attribute = 'expression'
			if (type === 'javaScriptShape') {
				attribute = 'generator.expression'
			} else if (type.startsWith('sksl')) {
				attribute = 'code'
			}
			for (const layerId of selection) {
				const layerType = api.getLayerType(layerId)
				if (layerType !== type) {
					const name = api.getNiceName(layerId)
					skipped.push(String(name))
					diagEntries.push({
						level: 'warn',
						text: `Stallion: Skipped layer '${String(name)}' because it is not of type '${type}'`,
					})
					continue
				}
				api.set(layerId, { [attribute]: code })
				applied.push(String(layerId))
				if (typeof parsed.attachTo === 'string' && parsed.attachTo) {
					if (type === 'skslShader') {
						api.connect(layerId, 'id', parsed.attachTo, 'material.shader')
					} else if (type === 'skslFilter') {
						api.connect(layerId, 'id', parsed.attachTo, 'filters')
					}
				}
			}
			if (type.startsWith('sksl')) {
				const skslCheck = validateSkslSource(code)
				valid = skslCheck.valid
				uniforms = skslCheck.uniforms
				diagEntries.push(...skslCheck.diagnostics)
			} else {
				const ctxCheck = validateCavalryContextUsage(code, type)
				valid = ctxCheck.valid
				diagEntries.push(...ctxCheck.diagnostics)
			}
		} else if (type.toLowerCase().includes('render')) {
			let items = api.getRenderQueueItems()
			if (!items.length && parsed.autoCreateRenderQueueItem !== false) {
				const createdId = api.addRenderQueueItem()
				items = [createdId]
			}
			for (const layerId of items) {
				const selected = api.get(layerId, 'selected')
				if (selected) {
					api.set(layerId, { [type]: code })
					applied.push(String(layerId))
				}
			}
			const ctxCheck = validateCavalryContextUsage(code, 'render')
			valid = ctxCheck.valid
			diagEntries.push(...ctxCheck.diagnostics)
		}

		if (diagEntries.length) {
			api.appendJsLog(diagEntries)
		}
		const baseReceipt = buildReceipt(scene, diagEntries, applied, beatFrames)
		const jsLogDiagnostics = captureJsLogDiagnostics(api.getJsLogPath())
		const context = payloadTypeToExecutionContext(type)
		const receipt: ExpressionReceipt = {
			...baseReceipt,
			payloadType: (isExpressionPayloadType(type) ? type : 'javaScriptUtility') as ExpressionPayloadType,
			context,
			applied,
			skipped,
			jsLogDiagnostics,
			valid,
			...(uniforms ? { uniforms } : {}),
		}
		return {
			type: RESULT_TYPE,
			kind: 'result',
			seq,
			ok: true,
			applied,
			skipped,
			receipt,
		}
	}

	/**
	 * A batch answer carries paths and boxes; the mock can additionally hand back
	 * pixels because it is real Node. Keep the payload bounded to the first 16
	 * frames. The live bridge cannot inline — its script host has no binary read —
	 * so the field is simply absent there rather than null.
	 */
	const applyBatchInline = (envelope: Record<string, unknown>, parsed: Record<string, unknown>, url: URL): void => {
		if (envelope.ok !== true) return
		const frames = Array.isArray(envelope.frames) ? (envelope.frames as Array<Record<string, unknown>>) : []
		const comp = scene.comps.get(String(envelope.compId ?? '')) ?? scene.activeComp()
		const pct = Number(envelope.scale)
		if (!inlineWanted(parsed, url) || !comp || !Number.isFinite(pct) || pct <= 0) return
		const width = Math.max(1, Math.round(comp.width * (pct / 100)))
		const height = Math.max(1, Math.round(comp.height * (pct / 100)))
		for (const entry of frames.slice(0, 16)) {
			const file = typeof entry.file === 'string' ? entry.file : ''
			const sidecar = `${file}.rgba`
			if (!file || !fs.existsSync(sidecar)) continue
			const rgba = fs.readFileSync(sidecar)
			if (rgba.length === width * height * 4) {
				entry.pngBase64 = encodePng(rgba, width, height).toString('base64')
				entry.width = width
				entry.height = height
			}
		}
	}

	const server = http.createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? '/', 'http://localhost')
			if (!bearerOk(request, token)) {
				serveJson(response, { error: 'unauthorized' }, 401)
				return
			}
			if (request.method === 'GET' && url.pathname === '/') {
				const body =
					'Stallion mock bridge — POST /post, GET /get, GET /health, POST /execute, POST /render-frames, POST /batch-step, ' +
					'GET|POST /state, /layers, /frame, /snapshot, /snapshot-batch, ' +
					'/batch_inspect, /export_comp_rig_overrides, /checkpoint, /rollback, /render_frame_fast, /determinism-check\n'
				response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) })
				response.end(body)
				return
			}
			if (request.method === 'GET' && url.pathname === '/health') {
				serveJson(response, {
					version: MOCK_VERSION,
					status: 'ok',
					purityGate: true,
					themes: [...ASTRYX_THEME_NAMES],
				})
				return
			}
			if (request.method === 'POST' && url.pathname === '/execute') {
				let parsedBody: Record<string, unknown> = {}
				try {
					const raw = await readBody(request)
					if (raw.trim()) parsedBody = JSON.parse(raw) as Record<string, unknown>
				} catch (err) {
					const message = String((err as Error)?.message ?? err)
					const status = /too large/i.test(message) ? 413 : 400
					serveJson(response, { ok: false, error: message }, status)
					return
				}
				const rawScript =
					typeof parsedBody.script === 'string'
						? parsedBody.script
						: typeof parsedBody.code === 'string'
							? parsedBody.code
							: ''
				const resolvedTheme = resolveAstryxTheme(
					typeof parsedBody.theme === 'string' ? parsedBody.theme : 'neutral',
				)
				const enforcePurity = parsedBody.enforcePurity !== false
				if (enforcePurity) {
					const purity = validateMgPurity(rawScript)
					if (!purity.passed) {
						serveJson(
							response,
							{
								error: 'Purity gate failed',
								score: purity.score,
								grade: purity.grade,
								violations: purity.violations,
								autoFixPrompt: purity.autoFixPrompt,
							},
							422,
						)
						return
					}
				}
				const preparedCode = injectSceneThemeInsideUndo(rawScript, resolvedTheme.themeName)
				const execEnvelope = handleScriptPost({
					...parsedBody,
					code: preparedCode,
					helpers: true,
					seq: parsedBody.seq ?? `execute-${Date.now()}`,
				})
				const finalPurity = validateMgPurity(preparedCode)
				const responsePayload = {
					...execEnvelope,
					theme: resolvedTheme.themeName,
					purity: {
						score: finalPurity.score,
						grade: finalPurity.grade,
						passed: finalPurity.passed,
					},
				}
				lastPayload = responsePayload
				serveJson(response, responsePayload, 200)
				return
			}
			// Literal batch-step route: the live bridge multiplexes batch-step as a
			// `type` on POST /post (Cavalry's WebServer has no router); the mock,
			// being real Node, also serves the path-shaped form and answers with the
			// identical envelope. A JSON body is merged over the query string.
			const fastPath =
				url.pathname === '/batch_inspect'
					? handleBatchInspectPost
					: url.pathname === '/export_comp_rig_overrides'
						? handleExportCompRigOverridesPost
						: url.pathname === '/checkpoint'
							? handleCheckpointPost
							: url.pathname === '/rollback'
								? handleRollbackPost
								: url.pathname === '/render_frame_fast'
									? handleRenderFrameFastPost
									: null
			if (fastPath && (request.method === 'POST' || request.method === 'GET')) {
				let parsed: Record<string, unknown> = { seq: url.searchParams.get('seq') ?? `${url.pathname.slice(1)}-${Date.now()}` }
				if (url.searchParams.get('comp') !== null) parsed.compId = url.searchParams.get('comp')
				if (url.searchParams.get('frame') !== null) parsed.frame = url.searchParams.get('frame')
				if (url.searchParams.get('frames') !== null) parsed.frames = (url.searchParams.get('frames') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
				if (url.searchParams.get('layerIds') !== null) parsed.layerIds = (url.searchParams.get('layerIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
				if (url.searchParams.get('attributes') !== null) parsed.attributes = (url.searchParams.get('attributes') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
				if (url.searchParams.get('snapshotId') !== null) parsed.snapshotId = url.searchParams.get('snapshotId')
				if (url.searchParams.get('scaleFactor') !== null) parsed.scaleFactor = url.searchParams.get('scaleFactor')
				if (request.method === 'POST') {
					try {
						const raw = await readBody(request)
						if (raw.trim()) parsed = { ...parsed, ...(JSON.parse(raw) as Record<string, unknown>) }
					} catch (err) {
						const message = String((err as Error)?.message ?? err)
						const status = /too large/i.test(message) ? 413 : 400
						serveJson(response, { ok: false, error: message }, status)
						return
					}
				}
				const envelope = fastPath(parsed)
				lastPayload = envelope
				serveJson(response, envelope)
				return
			}
			if (url.pathname === '/batch-step' && (request.method === 'POST' || request.method === 'GET')) {
				const q = url.searchParams
				let parsed: Record<string, unknown> = {
					type: BATCH_STEP_TYPE,
					seq: q.get('seq') ?? `batch-step-${Date.now()}`,
				}
				const framesQuery = q.get('sampleFrames') ?? q.get('frames')
				if (framesQuery !== null) parsed.sampleFrames = framesQuery.split(',').map((s) => s.trim()).filter(Boolean)
				const compQuery = q.get('comp') ?? q.get('compId')
				if (compQuery !== null) parsed.compId = compQuery
				if (q.get('scale') !== null) parsed.scale = q.get('scale')
				if (q.get('renderOutputDir') !== null) parsed.renderOutputDir = q.get('renderOutputDir')
				if (/^(1|true|yes)$/i.test(q.get('renderFrames') ?? '')) parsed.renderFrames = true
				if (/^(0|false|no)$/i.test(q.get('dirtyAttributesOnly') ?? '')) parsed.dirtyAttributesOnly = false
				if (request.method === 'POST') {
					try {
						const raw = await readBody(request)
						if (raw.trim()) parsed = { ...parsed, ...(JSON.parse(raw) as Record<string, unknown>), type: BATCH_STEP_TYPE }
					} catch (err) {
						const message = String((err as Error)?.message ?? err)
						const status = /too large/i.test(message) ? 413 : 400
						serveJson(response, errorEnvelope(BATCH_STEP_TYPE, ERROR_CODES.BAD_REQUEST, message), status)
						return
					}
				}
				const envelope = handleBatchStepPost(parsed)
				lastPayload = envelope
				serveJson(response, envelope)
				return
			}
			// Literal determinism-check route: mock-only, like /batch-step. The
			// live bridge multiplexes it as a `type` on POST /post; the mock also
			// answers the path-shaped form with the identical envelope, directly
			// rather than ack-then-poll. A JSON body is merged over the query.
			if (url.pathname === '/determinism-check' && (request.method === 'POST' || request.method === 'GET')) {
				const q = url.searchParams
				let parsed: Record<string, unknown> = {
					seq: q.get('seq') ?? `determinism-check-${Date.now()}`,
				}
				if (q.get('code') !== null) parsed.code = q.get('code')
				if (q.get('frames') !== null) parsed.frames = (q.get('frames') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
				if (q.get('frameCount') !== null) parsed.frameCount = q.get('frameCount')
				if (q.get('seed') !== null) parsed.seed = q.get('seed')
				if (q.get('width') !== null) parsed.width = q.get('width')
				if (q.get('budgetMs') !== null) parsed.budgetMs = q.get('budgetMs')
				if (/^(0|false|no)$/i.test(q.get('lint') ?? '')) parsed.lint = false
				if (request.method === 'POST') {
					try {
						const raw = await readBody(request)
						if (raw.trim()) parsed = { ...parsed, ...(JSON.parse(raw) as Record<string, unknown>) }
					} catch (err) {
						const message = String((err as Error)?.message ?? err)
						const status = /too large/i.test(message) ? 413 : 400
						serveJson(response, errorEnvelope(DETERMINISM_TYPE, ERROR_CODES.BAD_REQUEST, message), status)
						return
					}
				}
				const envelope = handleDeterminismPost(parsed)
				lastPayload = envelope
				serveJson(response, envelope)
				return
			}
			if (request.method === 'GET' && url.pathname === '/get') {
				serveJson(response, lastPayload ?? heartbeat())
				return
			}
			// Path-shaped introspection. The live bridge cannot route by URL at all —
			// Cavalry's WebServer has no router — so these routes are a mock-only surface,
			// and they answer with the identical envelope a `type`-shaped /post request
			// returns. A JSON body is merged over the query string (body wins), and unlike
			// POST /post these reply directly rather than ack-then-poll: a path-shaped
			// request has no queue contract to honour.
			const introspectPath: 'state' | 'layers' | 'snapshot' | 'snapshot-batch' | null =
				url.pathname === '/state' || url.pathname === '/layers'
					? (url.pathname === '/state' ? 'state' : 'layers')
					: url.pathname === '/snapshot-batch'
						? 'snapshot-batch'
						: url.pathname === '/frame' || url.pathname === '/snapshot'
							? 'snapshot'
							: null
			if (introspectPath && (request.method === 'GET' || request.method === 'HEAD' || request.method === 'POST')) {
				let parsed = introspectQuery(url, introspectPath as 'state' | 'layers' | 'snapshot' | 'snapshot-batch')
				if (request.method === 'POST') {
					try {
						const raw = await readBody(request)
						if (raw.trim()) parsed = { ...parsed, ...(JSON.parse(raw) as Record<string, unknown>) }
					} catch (err) {
						const message = String((err as Error)?.message ?? err)
						if (/too large/i.test(message)) {
							serveJson(response, errorEnvelope(introspectPath, ERROR_CODES.BAD_REQUEST, message), 413)
							return
						}
					}
				}
				const envelope =
					introspectPath === 'snapshot'
						? handleSnapshotPost(parsed)
						: introspectPath === 'snapshot-batch'
							? handleSnapshotBatchPost(parsed)
							: handleReadbackPost(introspectPath, parsed)
				lastPayload = envelope
				if (introspectPath === 'snapshot-batch') {
					applyBatchInline(envelope, parsed, url)
				}
				if (introspectPath === 'snapshot' && envelope.ok === true) {
					// A snapshot exists to short-circuit disk polling, so the mock hands the
					// pixels back rather than only naming a file. The live bridge cannot do
					// this — its script host has no binary read — which is why the field is
					// absent there rather than null.
					const file = typeof envelope.file === 'string' ? envelope.file : ''
					const sidecar = `${file}.rgba`
					if (inlineWanted(parsed, url) && fs.existsSync(sidecar)) {
						const comp = scene.comps.get(String(envelope.compId ?? '')) ?? scene.activeComp()
						const pct = Number(envelope.scale)
						if (comp && Number.isFinite(pct) && pct > 0) {
							const width = Math.max(1, Math.round(comp.width * (pct / 100)))
							const height = Math.max(1, Math.round(comp.height * (pct / 100)))
							const rgba = fs.readFileSync(sidecar)
							if (rgba.length === width * height * 4) {
								envelope.pngBase64 = encodePng(rgba, width, height).toString('base64')
								envelope.width = width
								envelope.height = height
							} else {
								envelope.inlineNote = `sidecar length ${rgba.length} does not match ${width}x${height}x4`
							}
						}
					}
				}
				if (request.method === 'HEAD') {
					response.writeHead(200, { 'Content-Type': 'application/json' })
					response.end()
					return
				}
				serveJson(response, envelope)
				return
			}
			if (request.method === 'POST' && (url.pathname === '/post' || url.pathname === '/render-frames')) {
				let body: string
				try {
					body = await readBody(request)
				} catch (err) {
					serveJson(response, { error: String((err as Error)?.message ?? err) }, 413)
					return
				}
				let parsed: Record<string, unknown>
				try {
					parsed = JSON.parse(body) as Record<string, unknown>
				} catch {
					serveJson(response, { error: 'Failed to parse request as JSON' }, 400)
					return
				}
				// Raw binary streaming for the literal render-frames route.
				if (url.pathname === '/render-frames' && (request.headers.accept ?? '').includes('application/octet-stream')) {
					const batch = await handleRenderFrames(parsed)
					const rendered = Array.isArray(batch.rendered) ? (batch.rendered as Array<Record<string, unknown>>) : []
					// Layout: u32 frame count, then per frame { u32 frame, u16 width,
					// u16 height, u32 byteLength, bytes }.
					const header = Buffer.alloc(4)
					header.writeUInt32BE(rendered.length, 0)
					const parts: Buffer[] = [header]
					for (const item of rendered) {
						const frameHeader = Buffer.alloc(8)
						frameHeader.writeUInt32BE(Number(item.frame), 0)
						frameHeader.writeUInt16BE(Number(item.width), 4)
						frameHeader.writeUInt16BE(Number(item.height), 6)
						const bytes = Buffer.from(String(item.bufferBase64 ?? ''), 'base64')
						const size = Buffer.alloc(4)
						size.writeUInt32BE(bytes.length, 0)
						parts.push(frameHeader, size, bytes)
					}
					const payload = Buffer.concat(parts)
					response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length })
					response.end(payload)
					return
				}
				const work = queue.then(async () => {
					let envelope: Record<string, unknown>
					if (parsed.type === RESULT_TYPE) {
						// internal loopback channel — serve verbatim, like the live bridge
						const canonical = parsed.batchEvalAndCaptureResult as Record<string, unknown> | undefined
						lastPayload = canonical?.kind === BATCH_EVAL_AND_CAPTURE_TYPE ? canonical : parsed
						envelope = { ok: true }
					} else if (parsed.type === BATCH_EVAL_AND_CAPTURE_TYPE) {
						envelope = handleBatchEvalAndCapturePost(parsed)
						lastPayload = envelope
					} else if (parsed.type === RENDER_FRAMES_TYPE) {
						envelope = await handleRenderFrames(parsed)
						lastPayload = envelope
					} else if (parsed.type === STATE_TYPE || parsed.type === LAYERS_TYPE) {
						envelope = handleReadbackPost(parsed.type === STATE_TYPE ? 'state' : 'layers', parsed)
						lastPayload = envelope
					} else if (parsed.type === SNAPSHOT_TYPE) {
						envelope = handleSnapshotPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === SNAPSHOT_BATCH_TYPE) {
						envelope = handleSnapshotBatchPost(parsed)
						applyBatchInline(envelope, parsed, url)
						lastPayload = envelope
					} else if (parsed.type === BATCH_STEP_TYPE) {
						envelope = handleBatchStepPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === BATCH_INSPECT_TYPE) {
						envelope = handleBatchInspectPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === EXPORT_COMP_RIG_OVERRIDES_TYPE) {
						envelope = handleExportCompRigOverridesPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === CHECKPOINT_TYPE) {
						envelope = handleCheckpointPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === ROLLBACK_TYPE) {
						envelope = handleRollbackPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === RENDER_FRAME_FAST_TYPE) {
						envelope = handleRenderFrameFastPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === DETERMINISM_TYPE) {
						envelope = handleDeterminismPost(parsed)
						lastPayload = envelope
					} else if (parsed.type === 'health') {
						envelope = {
							version: MOCK_VERSION,
							status: 'ok',
							purityGate: true,
							themes: [...ASTRYX_THEME_NAMES],
						}
						lastPayload = envelope
					} else if (parsed.type === 'execute') {
						const rawScript =
							typeof parsed.script === 'string'
								? parsed.script
								: typeof parsed.code === 'string'
									? parsed.code
									: ''
						const resolvedTheme = resolveAstryxTheme(
							typeof parsed.theme === 'string' ? parsed.theme : 'neutral',
						)
						const enforcePurity = parsed.enforcePurity !== false
						if (enforcePurity) {
							const purity = validateMgPurity(rawScript)
							if (!purity.passed) {
								envelope = {
									kind: 'execute',
									seq: parsed.seq ?? null,
									ok: false,
									status: 422,
									error: 'Purity gate failed',
									score: purity.score,
									grade: purity.grade,
									violations: purity.violations,
									autoFixPrompt: purity.autoFixPrompt,
								}
								lastPayload = envelope
								return envelope
							}
						}
						const preparedCode = injectSceneThemeInsideUndo(rawScript, resolvedTheme.themeName)
						envelope = handleScriptPost({
							...parsed,
							code: preparedCode,
							helpers: true,
						})
						lastPayload = envelope
					} else if (parsed.type === 'script' || parsed.path) {
						envelope = handleScriptPost(parsed)
						lastPayload = envelope
					} else if (
						typeof parsed.type === 'string' &&
						(parsed.type.startsWith('javaScript') || parsed.type.startsWith('sksl') || parsed.type.toLowerCase().includes('render'))
					) {
						envelope = handleExpressionPost(parsed)
						lastPayload = envelope
					} else {
						envelope = { type: RESULT_TYPE, kind: 'result', seq: parsed.seq ?? null, ok: false, error: `Unexpected type '${String(parsed.type)}'` }
						lastPayload = envelope
					}
					return envelope
				})
				try {
					await work
					// The live bridge answers POST with a fixed ack; results flow
					// through GET /get, so the mock keeps that contract.
					serveJson(response, { ok: true })
				} catch (err) {
					serveJson(response, { ok: false, error: String((err as Error)?.message ?? err) }, 500)
				}
				return
			}
			serveJson(response, { error: 'not found' }, 404)
		})().catch(() => {
			if (!response.headersSent) serveJson(response, { error: 'internal error' }, 500)
		})
	})

	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(requestedPort, host, () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : requestedPort
			resolve({
				port,
				host,
				scene,
				api,
				lastFrames: () => api.lastFrames.slice(),
				close: () =>
					new Promise<void>((resolveClose) => {
						server.close(() => resolveClose())
					}),
			})
		})
	})
}

/** CLI boot: `node dist/stallion-mock.js --mock [--port N] [--host H]`. */
export function shouldBootMock(argv: string[] = process.argv): boolean {
	if (argv.includes('--mock')) return true
	return process.env.STALLION_MOCK === '1'
}

export async function bootMockFromArgv(argv: string[] = process.argv): Promise<void> {
	const flag = (name: string, fallback?: string): string | undefined => {
		const index = argv.indexOf(name)
		return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
	}
	const handle = await startMockServer({
		host: flag('--host'),
		port: flag('--port') ? Number(flag('--port')) : undefined,
		token: flag('--token'),
		strictSchema: !argv.includes('--lax'),
		verbose: argv.includes('--verbose'),
	})
	process.stdout.write(`Stallion mock bridge v${MOCK_VERSION} — listening on ${handle.host}:${handle.port} (in-memory Cavalry 2.8 scene)\n`)
	const shutdown = () => {
		void handle.close().then(() => process.exit(0))
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}
