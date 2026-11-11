/**
 * Out-of-order frame determinism verification (`determinism-check`).
 *
 * Port of the framewright pre-render check (`.agents/skills/framewright/scripts/
 * check.mjs`) and the xiaoma-studio static lint (`engine/lint.mjs`) to the mock
 * bridge's vm sandbox: a submitted frame function must be a pure function of
 * `(t, seed, width)`, so evaluating the same frame in different orders — or in a
 * cold context — must produce identical results.
 *
 * Seven evaluation orders, one pass each (framewright's probe matrix):
 *
 *   1. forward            — probes ascending in one warm context
 *   2. backward           — probes descending in one warm context
 *   3. shuffled           — seeded LCG Fisher–Yates shuffle in one warm context
 *   4. after-previous     — frame f-1 evaluated (and discarded) before each probe
 *   5. after-other-width  — the probe evaluated at width*2 first (framewright's
 *                           "after another width": resolution-dependent caches)
 *   6. after-sweep        — a stride sweep over the whole film, then the probes
 *                           (state a render tab leaves behind reaches later frames)
 *   7. fresh              — a brand-new context per probe (the first frame a new
 *                           render tab draws)
 *
 * Within one pass the context persists, so state a frame leaves behind reaches
 * every later frame of that pass — exactly the failure mode the check exists to
 * catch. Per-frame results are compared by a stable serialization hash; any frame
 * whose hash differs across orders is reported with the orders grouped by hash.
 *
 * The static lint is the purity gate for this surface (the `_mg` rubric in
 * `validate-mg-purity.ts` gates scene-building scripts and is untouched): source
 * that calls `Math.random`, `Date.now`, `new Date`, `performance.now` or
 * `getRandomValues` fails — a frame may depend only on `(t, seed, width)`, and
 * randomness must come from a seeded hash. Writes to `globalThis` are warned as
 * probable frame-order state; the 7-order dynamic check is the authority there.
 *
 * Wire shape follows the rest of the bridge: a `type` on POST /post answered on
 * GET /get with the caller's `seq`, plus the mock-only literal route
 * `/determinism-check`. The envelope carries the standard receipt.
 */

import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { ERROR_CODES, type ErrorCode } from '../cavalry/modules/Introspect.ts'
import { type ConsoleEntry } from './receipt.ts'

export const DETERMINISM_TYPE = 'determinism-check'

/** The seven evaluation orders, in pass order (framewright check.mjs). */
export const DETERMINISM_ORDERS = [
	'forward',
	'backward',
	'shuffled',
	'after-previous',
	'after-other-width',
	'after-sweep',
	'fresh',
] as const

export type DeterminismOrder = (typeof DETERMINISM_ORDERS)[number]

/** Bounds mirror the bridge's other walks: bounded work per call, never a freeze. */
export const DETERMINISM_MAX_PROBES = 64
export const DETERMINISM_MAX_FRAME_COUNT = 10_000
export const DETERMINISM_MAX_CODE_BYTES = 200_000
export const DETERMINISM_DEFAULT_FRAME_COUNT = 120
export const DETERMINISM_DEFAULT_SEED = 7
export const DETERMINISM_DEFAULT_WIDTH = 480
const SETUP_TIMEOUT_MS = 5_000
const EVAL_TIMEOUT_MS = 5_000
const DEFAULT_BUDGET_MS = 30_000
const MAX_BUDGET_MS = 120_000
const MAX_REPORTED_MISMATCHES = 8
const MAX_REPORTED_ERRORS = 16

export interface DeterminismJob {
	seq: unknown
	/**
	 * JavaScript source evaluated once per context. It must either evaluate to a
	 * function `(t, seed, width) => value` (function-expression form) or define a
	 * global `frame(t, seed, width)` function (script form). The returned value is
	 * the frame's result and is compared by stable serialization.
	 */
	code: string
	/** Probe frames, sorted and deduplicated. */
	frames: number[]
	/** Film length in frames; drives the default probes and the sweep stride. */
	frameCount: number
	seed: number
	width: number
	/** Run the static source lint (the purity gate for this surface). */
	lint: boolean
	/** Wall-clock ceiling for the whole check; a truncated check never passes. */
	budgetMs: number
}

export interface DeterminismLintViolation {
	rule: 'nondeterministic_source' | 'frame_order_state'
	line: number
	severity: 'fail' | 'warn'
	snippet: string
	message: string
}

export interface DeterminismLintResult {
	passed: boolean
	violations: DeterminismLintViolation[]
}

export interface DeterminismMismatch {
	frame: number
	/** Orders grouped by result hash, e.g. `forward = backward vs shuffled = fresh`. */
	detail: string
	hashes: Partial<Record<DeterminismOrder, string>>
}

export interface DeterminismReport {
	deterministic: boolean
	orders: DeterminismOrder[]
	probes: number
	frames: number[]
	frameCount: number
	seed: number
	width: number
	evaluations: number
	mismatchCount: number
	mismatches: DeterminismMismatch[]
	errors: Array<{ frame: number | null; order: string; error: string }>
	setupError: string | null
	truncated: boolean
	lint: DeterminismLintResult
	consoleDiagnostics: ConsoleEntry[]
}

/**
 * Static source lint adapted from framewright check.mjs (banned time/random APIs,
 * comments blanked first so a rule quoted in a comment does not trip it) and the
 * xiaoma-studio determinism intent (no unseeded randomness, no frame-order state).
 * String literals are masked like `validateCavalryContextUsage` does.
 */
export function lintDeterminismSource(code: string): DeterminismLintResult {
	const raw = String(code ?? '')
	const rawLines = raw.split(/\r?\n/)
	const masked = raw
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
		.replace(/(^|[^:\\'"])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length))
		.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
	const maskedLines = masked.split(/\r?\n/)
	const violations: DeterminismLintViolation[] = []

	const banned: Array<[RegExp, string]> = [
		[/\bMath\.random\s*\(/, 'Math.random'],
		[/\bDate\.now\s*\(|\bnew\s+Date\s*\(/, 'Date'],
		[/\bperformance\.now\s*\(/, 'performance.now'],
		[/\bgetRandomValues\s*\(/, 'crypto.getRandomValues'],
	]
	for (let i = 0; i < maskedLines.length; i++) {
		for (const [re, name] of banned) {
			if (re.test(maskedLines[i])) {
				violations.push({
					rule: 'nondeterministic_source',
					line: i + 1,
					severity: 'fail',
					snippet: (rawLines[i] ?? '').trim().slice(0, 120),
					message: `Line ${i + 1} calls ${name}: a frame may depend only on (t, seed, width); take randomness from a seeded hash instead.`,
				})
			}
		}
	}

	// Probable frame-order state: a write to a global survives between frames, so
	// the result depends on what was evaluated before. Warn, don't fail — a cache
	// keyed on all its inputs is legal, and the 7-order check is the authority.
	const globalWrite = /\b(?:globalThis|window|self)\s*\.\s*[A-Za-z_$][\w$]*\s*(?:=(?!=)|\+\+|--|\+=|-=|\*=|\/=)/
	for (let i = 0; i < maskedLines.length; i++) {
		if (globalWrite.test(maskedLines[i])) {
			violations.push({
				rule: 'frame_order_state',
				line: i + 1,
				severity: 'warn',
				snippet: (rawLines[i] ?? '').trim().slice(0, 120),
				message: `Line ${i + 1} writes a global: state that survives a frame makes results depend on evaluation order. Keep every value a pure function of (t, seed, width).`,
			})
		}
	}

	return { passed: !violations.some((v) => v.severity === 'fail'), violations }
}

/**
 * Validate a `determinism-check` payload. Same shape as the bridge's other
 * normalizers: `{ job }` on success, `{ error, code }` on a bad request.
 */
export function normalizeDeterminismJob(
	parsed: Record<string, unknown>,
): { job: DeterminismJob } | { error: string; code: ErrorCode } {
	const code = typeof parsed.code === 'string' ? parsed.code : ''
	if (!code.trim()) {
		return { error: 'determinism-check requires a non-empty `code` string: a function expression (t, seed, width) => value, or a script defining frame(t, seed, width).', code: ERROR_CODES.BAD_REQUEST }
	}
	if (Buffer.byteLength(code, 'utf8') > DETERMINISM_MAX_CODE_BYTES) {
		return { error: `determinism-check \`code\` exceeds ${DETERMINISM_MAX_CODE_BYTES} bytes.`, code: ERROR_CODES.BAD_REQUEST }
	}

	const frameCountRaw = Number(parsed.frameCount ?? DETERMINISM_DEFAULT_FRAME_COUNT)
	if (!Number.isFinite(frameCountRaw) || frameCountRaw < 1 || frameCountRaw > DETERMINISM_MAX_FRAME_COUNT) {
		return { error: `determinism-check \`frameCount\` must be 1..${DETERMINISM_MAX_FRAME_COUNT}.`, code: ERROR_CODES.BAD_REQUEST }
	}
	const frameCount = Math.round(frameCountRaw)

	let frames: number[]
	if (parsed.frames !== undefined && parsed.frames !== null) {
		if (!Array.isArray(parsed.frames)) {
			return { error: 'determinism-check `frames` must be an array of frame numbers.', code: ERROR_CODES.BAD_REQUEST }
		}
		const raw = parsed.frames.map((f) => Math.round(Number(f)))
		if (raw.some((f) => !Number.isFinite(f) || f < 0 || f > 1_000_000)) {
			return { error: 'determinism-check `frames` entries must be finite frame numbers 0..1000000.', code: ERROR_CODES.BAD_REQUEST }
		}
		frames = [...new Set(raw)].sort((a, b) => a - b)
		if (!frames.length || frames.length > DETERMINISM_MAX_PROBES) {
			return { error: `determinism-check requires 1..${DETERMINISM_MAX_PROBES} distinct probe frames.`, code: ERROR_CODES.BAD_REQUEST }
		}
	} else {
		// framewright probes first / quarter / middle / three-quarter / last.
		frames = [...new Set([0, Math.floor(frameCount / 4), Math.floor(frameCount / 2), Math.floor((3 * frameCount) / 4), frameCount - 1])].sort((a, b) => a - b)
	}

	const seedRaw = Number(parsed.seed ?? DETERMINISM_DEFAULT_SEED)
	const widthRaw = Number(parsed.width ?? DETERMINISM_DEFAULT_WIDTH)
	if (!Number.isFinite(seedRaw)) {
		return { error: 'determinism-check `seed` must be a finite number.', code: ERROR_CODES.BAD_REQUEST }
	}
	if (!Number.isFinite(widthRaw) || widthRaw <= 0 || widthRaw > 100_000) {
		return { error: 'determinism-check `width` must be a positive number up to 100000.', code: ERROR_CODES.BAD_REQUEST }
	}
	const budgetRaw = Number(parsed.budgetMs ?? DEFAULT_BUDGET_MS)
	const budgetMs = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.min(MAX_BUDGET_MS, Math.round(budgetRaw)) : DEFAULT_BUDGET_MS

	return {
		job: {
			seq: parsed.seq,
			code,
			frames,
			frameCount,
			seed: Math.round(seedRaw),
			width: Math.round(widthRaw),
			lint: parsed.lint !== false,
			budgetMs,
		},
	}
}

/** Stable serialization: sorted keys, explicit tokens for the values JSON drops. */
function stableKey(value: unknown, seen: WeakSet<object>): string {
	if (value === undefined) return 'undefined'
	if (value === null) return 'null'
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'NaN'
		if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
		return Object.is(value, -0) ? '-0' : String(value)
	}
	if (typeof value === 'bigint') return `${value}n`
	if (typeof value === 'function') return `function:${value.name || 'anonymous'}`
	if (typeof value === 'symbol') return value.toString()
	if (typeof value !== 'object') return JSON.stringify(value)
	if (seen.has(value)) return '[circular]'
	seen.add(value)
	let out: string
	if (Array.isArray(value)) {
		out = `[${value.map((v) => stableKey(v, seen)).join(',')}]`
	} else {
		const record = value as Record<string, unknown>
		out = `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableKey(record[k], seen)}`).join(',')}}`
	}
	seen.delete(value)
	return out
}

function resultHash(value: unknown): string {
	return createHash('sha256').update(stableKey(value, new WeakSet())).digest('hex').slice(0, 16)
}

/** framewright's seeded LCG (check.mjs): the shuffle is reproducible per seed. */
function seededShuffle(frames: number[], seed: number): number[] {
	let z = (seed * 2654435761) >>> 0
	const rnd = () => (z = (Math.imul(z, 1664525) + 1013904223) >>> 0) / 4294967296
	const mixed = [...frames]
	for (let i = mixed.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1))
		;[mixed[i], mixed[j]] = [mixed[j], mixed[i]]
	}
	return mixed
}

interface EvalContext {
	ctx: vm.Context
	sandbox: Record<string, unknown>
	entries: ConsoleEntry[]
}

/**
 * One warm context: run the submitted source once, resolve the frame function
 * (completion value, or a global `frame` / `__frameFn`), and bind `__frameFn` so
 * every probe call goes through `vm.runInContext` with a timeout.
 */
function createEvalContext(code: string, entries: ConsoleEntry[]): EvalContext {
	const sandboxConsole = {
		log: (...args: unknown[]) => entries.push({ level: 'log', text: args.map(String).join(' ') }),
		info: (...args: unknown[]) => entries.push({ level: 'info', text: args.map(String).join(' ') }),
		warn: (...args: unknown[]) => entries.push({ level: 'warn', text: args.map(String).join(' ') }),
		error: (...args: unknown[]) => entries.push({ level: 'error', text: args.map(String).join(' ') }),
	}
	const sandbox: Record<string, unknown> = { console: sandboxConsole }
	const ctx = vm.createContext(sandbox)
	const completion = vm.runInContext(code, ctx, { timeout: SETUP_TIMEOUT_MS })
	if (typeof completion === 'function') {
		sandbox.__frameFn = completion
	} else if (typeof sandbox.frame === 'function' || typeof sandbox.__frameFn === 'function') {
		vm.runInContext('var __frameFn = typeof frame === "function" ? frame : __frameFn;', ctx, { timeout: SETUP_TIMEOUT_MS })
	} else {
		throw new Error('code must evaluate to a function (t, seed, width) => value, or define a global frame(t, seed, width) function')
	}
	return { ctx, sandbox, entries }
}

/**
 * Run the 7-order determinism check. Total: setup failures, per-frame throws and
 * budget exhaustion are reported, never thrown. The scene is not touched.
 */
export function runDeterminismCheck(job: DeterminismJob): DeterminismReport {
	const startedAt = Date.now()
	const lint = job.lint ? lintDeterminismSource(job.code) : { passed: true, violations: [] }
	const allEntries: ConsoleEntry[] = []
	const errors: DeterminismReport['errors'] = []
	const hashes = new Map<number, Partial<Record<DeterminismOrder, string>>>()
	let evaluations = 0
	let truncated = false
	let setupError: string | null = null

	const overBudget = () => {
		if (Date.now() - startedAt > job.budgetMs) {
			truncated = true
			return true
		}
		return false
	}

	// Trial setup: a source that cannot even define its frame function fails once,
	// identically for every order — report it as a setup error, not 7 duplicates.
	try {
		const trial = createEvalContext(job.code, allEntries)
		void trial
	} catch (err) {
		setupError = String((err as Error)?.message ?? err)
	}

	const evaluate = (evalCtx: EvalContext, frame: number, width: number): string | null => {
		evaluations++
		try {
			const value = vm.runInContext(`__frameFn(${frame}, ${job.seed}, ${width})`, evalCtx.ctx, { timeout: EVAL_TIMEOUT_MS })
			return resultHash(value)
		} catch (err) {
			if (errors.length < MAX_REPORTED_ERRORS) {
				errors.push({ frame, order: 'eval', error: String((err as Error)?.message ?? err) })
			}
			return null
		}
	}

	const record = (frame: number, order: DeterminismOrder, hash: string | null) => {
		if (hash === null) return
		const entry = hashes.get(frame) ?? {}
		entry[order] = hash
		hashes.set(frame, entry)
	}

	if (!setupError) {
		for (const order of DETERMINISM_ORDERS) {
			if (truncated) break
			if (order === 'fresh') {
				// A brand-new context per probe: the first frame a new render tab draws.
				for (const frame of job.frames) {
					if (overBudget()) break
					try {
						const evalCtx = createEvalContext(job.code, allEntries)
						record(frame, order, evaluate(evalCtx, frame, job.width))
					} catch (err) {
						if (errors.length < MAX_REPORTED_ERRORS) {
							errors.push({ frame, order, error: String((err as Error)?.message ?? err) })
						}
					}
				}
				continue
			}
			let evalCtx: EvalContext
			try {
				evalCtx = createEvalContext(job.code, allEntries)
			} catch (err) {
				if (errors.length < MAX_REPORTED_ERRORS) {
					errors.push({ frame: null, order, error: String((err as Error)?.message ?? err) })
				}
				continue
			}
			const probes =
				order === 'backward' ? [...job.frames].reverse()
				: order === 'shuffled' ? seededShuffle(job.frames, job.seed)
				: job.frames
			if (order === 'after-sweep') {
				// A render tab walks the film every stride frames; state one frame
				// leaves behind reaches every later frame of the tab.
				const stride = Math.max(5, Math.ceil(job.frameCount / 400))
				for (let f = 0; f < job.frameCount && !truncated; f += stride) {
					if (overBudget()) break
					evaluate(evalCtx, f, job.width)
				}
			}
			for (const frame of probes) {
				if (overBudget()) break
				if (order === 'after-previous' && frame > 0) {
					evaluate(evalCtx, frame - 1, job.width)
				} else if (order === 'after-other-width') {
					evaluate(evalCtx, frame, job.width * 2)
				}
				record(frame, order, evaluate(evalCtx, frame, job.width))
			}
		}
	}

	// Console errors are failures (framewright check.mjs); warnings stay diagnostics.
	for (const entry of allEntries) {
		if (entry.level === 'error' && errors.length < MAX_REPORTED_ERRORS) {
			errors.push({ frame: null, order: 'console', error: entry.text.slice(0, 240) })
		}
	}

	const mismatches: DeterminismMismatch[] = []
	let mismatchCount = 0
	for (const frame of job.frames) {
		const entry = hashes.get(frame)
		if (!entry) continue
		const distinct = new Set(Object.values(entry))
		if (distinct.size < 2) continue
		mismatchCount++
		if (mismatches.length >= MAX_REPORTED_MISMATCHES) continue
		const groups = new Map<string, string[]>()
		for (const [order, hash] of Object.entries(entry)) {
			const list = groups.get(hash as string) ?? []
			list.push(order)
			groups.set(hash as string, list)
		}
		mismatches.push({
			frame,
			detail: [...groups.values()].map((list) => list.join(' = ')).join('  vs  '),
			hashes: entry,
		})
	}

	const deterministic = !setupError && !truncated && mismatchCount === 0 && errors.length === 0
	return {
		deterministic,
		orders: [...DETERMINISM_ORDERS],
		probes: job.frames.length,
		frames: job.frames,
		frameCount: job.frameCount,
		seed: job.seed,
		width: job.width,
		evaluations,
		mismatchCount,
		mismatches,
		errors,
		setupError,
		truncated,
		lint,
		consoleDiagnostics: allEntries.slice(0, 64).map((e) => ({ level: e.level, text: e.text.slice(0, 240) })),
	}
}
