/**
 * Structured IIFE exception telemetry.
 *
 * When a script evaluation fails, callers get a machine-readable diagnostic
 * payload — not just a string — so upstream agents (cavalry-mcp, refclone) can
 * locate the failing line, the last mutated layer/attribute and the offending
 * snippet without re-running anything:
 *
 *   { ok: false, errorType, message, lineOffset, columnOffset,
 *     lastLayerId, lastAttributePath, snippet }
 *
 * `lineOffset` / `columnOffset` are 1-based coordinates INSIDE the user's
 * original script: the wrapper (undo-group IIFE, `_mg` preamble, telemetry
 * harness) is subtracted out, so the same code reports the same coordinates on
 * the mock bridge and in a live Cavalry app.
 */

export interface LastMutation {
	layerId: string
	attrPath: string
}

export interface StructuredError {
	errorType: string
	message: string
	lineOffset: number | null
	columnOffset: number | null
	lastLayerId: string | null
	lastAttributePath: string | null
	snippet: string | null
}

/**
 * Extract the first `line:column` pair from a V8/JS engine stack. Stack lines
 * look like `at evalmachine.<anonymous>:12:7`, `at Foo (<anonymous>:3:1)` or
 * `CavalryScript.js:9:2`. Returns raw engine coordinates or null.
 */
export function parseStackLocation(stack: string | null | undefined): { line: number; column: number } | null {
	if (!stack || typeof stack !== 'string') return null
	for (const match of stack.matchAll(/:(\d+):(\d+)/g)) {
		const line = Number(match[1])
		const column = Number(match[2])
		if (Number.isFinite(line) && line > 0 && Number.isFinite(column) && column > 0) {
			return { line, column }
		}
	}
	return null
}

/** Best-effort error classification: constructor name, else syntax/runtime heuristic. */
export function classifyErrorType(err: unknown): string {
	// Errors crossing the vm realm are not `instanceof Error` in the host, so
	// classification reads the duck-typed `name`/`message` properties instead.
	const name = err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string' ? String((err as { name: string }).name) : ''
	const text = err instanceof Error ? String(err.message ?? err) : String(err)
	if (name && name !== 'Error') return name
	if (/SyntaxError|Unexpected|Invalid|unexpected token/i.test(text)) return 'SyntaxError'
	if (name === 'Error' || err instanceof Error) return 'Error'
	return 'UnknownError'
}

/** Prefer the duck-typed `message` property; vm-realm errors stringify with a prefix. */
function errorMessage(err: unknown): string {
	if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string' && (err as { message: string }).message) {
		return String((err as { message: string }).message)
	}
	return String(err)
}

/**
 * Extract the offending source line from the ORIGINAL user code for a snippet.
 * A caret marks the reported column when it is usable.
 */
function extractSnippet(userCode: string, line: number | null, column: number | null): string | null {
	if (line === null || line < 1) return null
	const lines = String(userCode).split(/\r?\n/)
	const target = lines[line - 1]
	if (target === undefined) return null
	const trimmed = target.length > 200 ? `${target.slice(0, 197)}...` : target
	if (column !== null && column >= 1 && column <= target.length + 1) {
		const caret = `${' '.repeat(Math.min(column - 1, trimmed.length))}^`
		return `${trimmed}\n${caret}`
	}
	return trimmed
}

/**
 * Build the structured payload for a failed evaluation.
 *
 * @param err         the thrown value
 * @param userCode    the ORIGINAL user script (without wrapper/preamble)
 * @param codeStartLine 1-based line, inside the evaluated (wrapped) source,
 *                     where the user code begins — the harness subtracts it
 *                     so coordinates are user-relative
 * @param codeStartColumn 1-based column where user code starts on
 *                     `codeStartLine` (the wrapper prefix length + 1)
 * @param stack       the engine stack string
 * @param lastMutation most recent layer mutation recorded by the host, if any
 */
export function buildStructuredError(
	err: unknown,
	userCode: string,
	codeStartLine: number,
	codeStartColumn: number,
	stack: string | null,
	lastMutation: LastMutation | null,
): StructuredError {
	const message = errorMessage(err)
	const engine = parseStackLocation(stack)
	let lineOffset: number | null = null
	let columnOffset: number | null = null
	if (engine) {
		const relative = engine.line - (codeStartLine - 1)
		if (relative >= 1 && relative <= String(userCode).split(/\r?\n/).length) {
			lineOffset = relative
			columnOffset = relative === 1 ? engine.column - (codeStartColumn - 1) : engine.column
		}
	}
	return {
		errorType: classifyErrorType(err),
		message,
		lineOffset,
		columnOffset,
		lastLayerId: lastMutation ? String(lastMutation.layerId) : null,
		lastAttributePath: lastMutation ? String(lastMutation.attrPath) : null,
		snippet: extractSnippet(userCode, lineOffset, columnOffset),
	}
}
