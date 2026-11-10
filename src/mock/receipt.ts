/**
 * Deterministic mock receipt (sceneStateHash / consoleDiagnostics / beatBBoxes)
 * plus context-scoped expression/shader validation and `js_log.txt` diagnostic capture.
 */

import fs from 'node:fs'
import { MockScene, sceneDigest } from './scene.ts'

export interface ConsoleEntry {
	level: string
	text: string
}

export const EXPRESSION_PAYLOAD_TYPES = [
	'javaScriptShape',
	'javaScriptUtility',
	'javaScriptModifier',
	'javaScriptDeformer',
	'javaScriptEmitter',
	'skslShader',
	'skslFilter',
	'preRenderExpression',
	'postRenderExpression',
] as const

export type ExpressionPayloadType = (typeof EXPRESSION_PAYLOAD_TYPES)[number]

export const CAVALRY_EXECUTION_CONTEXTS = [
	'script',
	'plugin',
	'render',
	'shape',
	'utility',
	'deformer',
	'emitter',
	'modifier',
] as const

export type CavalryExecutionContext = (typeof CAVALRY_EXECUTION_CONTEXTS)[number]

export const CONTEXT_GLOBALS_BY_CONTEXT: Record<CavalryExecutionContext, readonly string[]> = {
	script: ['console', 'api', 'cavalry', 'ui'],
	plugin: ['console', 'api', 'ctx', 'cavalry', 'ui', 'plugin', 'install'],
	render: ['console', 'api', 'render'],
	shape: ['console', 'ctx', 'cavalry'],
	utility: ['console', 'ctx', 'cavalry'],
	deformer: ['console', 'ctx', 'cavalry', 'def'],
	emitter: ['console', 'ctx', 'cavalry'],
	modifier: ['console', 'ctx', 'cavalry'],
}

export function isExpressionPayloadType(type: unknown): type is ExpressionPayloadType {
	return typeof type === 'string' && (EXPRESSION_PAYLOAD_TYPES as readonly string[]).includes(type)
}

export function payloadTypeToExecutionContext(type: string): CavalryExecutionContext {
	switch (type) {
		case 'javaScriptShape':
			return 'shape'
		case 'javaScriptUtility':
			return 'utility'
		case 'javaScriptModifier':
			return 'modifier'
		case 'javaScriptDeformer':
			return 'deformer'
		case 'javaScriptEmitter':
			return 'emitter'
		case 'preRenderExpression':
		case 'postRenderExpression':
		case 'renderSetupExpression':
		case 'render':
			return 'render'
		case 'plugin':
			return 'plugin'
		case 'shape':
		case 'utility':
		case 'deformer':
		case 'emitter':
		case 'modifier':
			return type
		default:
			return 'script'
	}
}

export interface ContextValidationResult {
	valid: boolean
	context: CavalryExecutionContext
	allowedGlobals: string[]
	forbiddenUsages: string[]
	diagnostics: ConsoleEntry[]
}

/**
 * Validate that JS code targeting one of the 8 Cavalry execution contexts only
 * references global namespaces exposed in that context (`@scenery/cavalry-types`).
 */
export function validateCavalryContextUsage(code: string, contextOrPayloadType: string): ContextValidationResult {
	const context = payloadTypeToExecutionContext(contextOrPayloadType)
	const allowed = new Set(CONTEXT_GLOBALS_BY_CONTEXT[context])
	const allNamespaces = ['api', 'cavalry', 'ctx', 'def', 'ui', 'plugin', 'install', 'render']
	// Strip comments and string literals before scanning identifier namespaces
	const stripped = String(code ?? '')
		.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ' ')
		.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
	const forbiddenUsages: string[] = []
	const diagnostics: ConsoleEntry[] = []
	for (const ns of allNamespaces) {
		if (allowed.has(ns)) continue
		const pattern = new RegExp(`\\b${ns}\\s*\\.\\s*([A-Za-z_]\\w*)`, 'g')
		for (const match of stripped.matchAll(pattern)) {
			const usage = `${ns}.${match[1]}`
			if (!forbiddenUsages.includes(usage)) {
				forbiddenUsages.push(usage)
				diagnostics.push({
					level: 'error',
					text: `Context '${context}' (${contextOrPayloadType}) does not expose '${ns}' (found '${usage}'). Allowed globals: ${[...allowed].join(', ')}`,
				})
			}
		}
	}
	return {
		valid: forbiddenUsages.length === 0,
		context,
		allowedGlobals: [...allowed],
		forbiddenUsages,
		diagnostics,
	}
}

export interface SkslValidationResult {
	valid: boolean
	uniforms: Array<{ type: string; name: string }>
	errors: string[]
	warnings: string[]
	diagnostics: ConsoleEntry[]
}

/** Validate SkSL shader/filter source code and extract uniform declarations. */
export function validateSkslSource(code: string): SkslValidationResult {
	const src = String(code ?? '').trim()
	const errors: string[] = []
	const warnings: string[] = []
	const uniforms: Array<{ type: string; name: string }> = []

	if (!src) {
		errors.push('SkSL source is empty')
	} else {
		let depth = 0
		for (const ch of src) {
			if (ch === '{') depth += 1
			else if (ch === '}') depth -= 1
			if (depth < 0) break
		}
		if (depth !== 0) {
			errors.push('SkSL syntax error: unbalanced braces `{}`')
		}
		if (!/\b(?:half4|vec4|float4)\s+main\s*\(/.test(src)) {
			errors.push('SkSL shader must define a `half4 main(float2 fragCoord)` or `vec4 main(vec2 coord)` entry point')
		}
		if (/\bgl_FragColor\b/.test(src)) {
			warnings.push('SkSL uses return value from `main(float2 fragCoord)` instead of legacy GLSL `gl_FragColor`')
		}
		for (const match of src.matchAll(/\buniform\s+(float|int|bool|half\d*|vec\d+|float\d+|mat\d+|shader)\s+([A-Za-z_]\w*)\s*;/g)) {
			uniforms.push({ type: match[1], name: match[2] })
		}
	}

	const diagnostics: ConsoleEntry[] = [
		...errors.map((e) => ({ level: 'error', text: e })),
		...warnings.map((w) => ({ level: 'warn', text: w })),
	]
	return {
		valid: errors.length === 0,
		uniforms,
		errors,
		warnings,
		diagnostics,
	}
}

/**
 * Parse Cavalry `js_log.txt` contents (or read from a file path if it exists on disk)
 * into structured console diagnostic entries (`warn` / `error` / `info` / `log`).
 */
export function captureJsLogDiagnostics(logPathOrText?: string | null): ConsoleEntry[] {
	if (!logPathOrText) return []
	let raw = String(logPathOrText)
	if (!raw.includes('\n') && (raw.endsWith('.txt') || raw.endsWith('.log') || raw.includes('/') || raw.includes('\\'))) {
		try {
			if (fs.existsSync(raw)) {
				raw = fs.readFileSync(raw, 'utf8')
			} else {
				return []
			}
		} catch {
			return []
		}
	}
	const entries: ConsoleEntry[] = []
	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line) continue
		const bracketMatch = /^\[(ERROR|WARN|WARNING|INFO|LOG)\]\s*(.*)$/i.exec(line)
		if (bracketMatch) {
			const tag = bracketMatch[1].toLowerCase()
			const level = tag === 'warning' ? 'warn' : tag
			entries.push({ level, text: bracketMatch[2].slice(0, 240) })
			continue
		}
		if (/\b(ReferenceError|TypeError|SyntaxError|Error|error)\b/.test(line)) {
			entries.push({ level: 'error', text: line.slice(0, 240) })
		} else if (/\b(warn|warning|Skipped layer|unknown attribute)\b/i.test(line)) {
			entries.push({ level: 'warn', text: line.slice(0, 240) })
		} else {
			entries.push({ level: 'info', text: line.slice(0, 240) })
		}
	}
	return entries.slice(-64)
}

export interface ExpressionReceipt {
	sceneStateHash: string
	consoleDiagnostics: ConsoleEntry[]
	jsLogDiagnostics: ConsoleEntry[]
	beatBBoxes: Record<string, unknown>
	payloadType: ExpressionPayloadType | string
	context: CavalryExecutionContext | 'sksl'
	applied: string[]
	skipped: string[]
	valid: boolean
	uniforms?: Array<{ type: string; name: string }>
}

/** Deterministic receipt for the current scene state. */
export function buildReceipt(
	scene: MockScene,
	consoleEntries: ConsoleEntry[],
	receiptIds: string[],
	beatFrames: number[],
): { sceneStateHash: string; consoleDiagnostics: ConsoleEntry[]; beatBBoxes: Record<string, unknown> } {
	const beatBBoxes: Record<string, unknown> = {}
	const frames = beatFrames.slice(0, 32)
	if (frames.length) {
		const previous = scene.frame
		try {
			for (const frame of frames) {
				scene.frame = frame
				const boxes: Record<string, unknown> = {}
				for (const id of receiptIds.slice(0, 50)) {
					const box = scene.boundingBox(id)
					const rotation = scene.layer(id) ? Number(scene.getAttr(scene.layer(id)!, 'rotation')) || 0 : 0
					if (box) boxes[id] = { x: box.x, y: box.y, width: box.width, height: box.height, pivotX: box.centre.x, pivotY: box.centre.y, rotation }
				}
				beatBBoxes[String(frame)] = boxes
			}
		} finally {
			scene.frame = previous
		}
	}
	const facts = scene.facts()
	const parts = facts.layers.map((l) => `${l.id}:${l.type}@k=${l.keyframes}`)
	// Schema rejections and other scene diagnostics surface as warnings — the
	// live bridge reports them through its console probe instead.
	const diagnostics: ConsoleEntry[] = consoleEntries.slice(0, 64).map((e) => ({ level: e.level, text: e.text.slice(0, 240) }))
	for (const entry of scene.diagnostics) {
		if (diagnostics.length >= 64) break
		diagnostics.push({ level: entry.level, text: entry.text.slice(0, 240) })
	}
	return {
		sceneStateHash: sceneDigest(`nodes(${parts.join(';')})conn(${facts.connections.join(';')})`),
		consoleDiagnostics: diagnostics,
		beatBBoxes,
	}
}
