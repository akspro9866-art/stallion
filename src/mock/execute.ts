/**
 * Execute script code against the mock scene in a fresh or preloaded vm context (extracted from mock/server.ts; behaviour unchanged).
 */

import vm from 'node:vm'
import { MockApi } from './api.ts'
import { type ConsoleEntry } from './receipt.ts'

/** Execute script code against the mock scene in a fresh vm context. */
export function executeOnMock(
	code: string,
	api: MockApi,
	options: { verbose?: boolean; context?: vm.Context } = {},
): { result: unknown; error: string | null; stack: string | null; console: ConsoleEntry[]; state: Record<string, unknown> | null } {
	const entries: ConsoleEntry[] = []
	const sandboxConsole = {
		log: (...args: unknown[]) => entries.push({ level: 'log', text: args.map(String).join(' ') }),
		info: (...args: unknown[]) => entries.push({ level: 'info', text: args.map(String).join(' ') }),
		warn: (...args: unknown[]) => entries.push({ level: 'warn', text: args.map(String).join(' ') }),
		error: (...args: unknown[]) => entries.push({ level: 'error', text: args.map(String).join(' ') }),
	}
	const isAtomic = code.startsWith('/* cavalry-mcp:atomic */')
	const trimmed = isAtomic ? code : `(function () {
		if (typeof api.startUndoGroup === 'function') api.startUndoGroup('AI Motion Batch');
		try {
			return (function () { ${code}\n})();
		} finally {
			if (typeof api.endUndoGroup === 'function') api.endUndoGroup();
		}
	})()`
	const before = new Set(api.scene.layers.keys())
	const sandbox: Record<string, unknown> = {
		api,
		console: sandboxConsole,
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
	}
	let result: unknown
	let error: string | null = null
	let stack: string | null = null
	try {
		if (options.context) {
			// Persistent preloaded context (preloadMg: true): the sandbox global
			// state — including `globalThis._mg` from the startup preload —
			// survives between calls, exactly like a live shared script context.
			const ctx = options.context as unknown as Record<string, unknown>
			ctx.__result = undefined
			ctx.__stallionState = undefined
			ctx.__stallionRunConsole = sandboxConsole
			result = vm.runInContext(`var __returned = (${trimmed}); typeof __result === 'undefined' ? __returned : __result`, options.context, {
				timeout: 30_000,
			})
		} else {
			result = vm.runInNewContext(`var __returned = (${trimmed}); typeof __result === 'undefined' ? __returned : __result`, sandbox, {
				timeout: 30_000,
			})
		}
	} catch (err) {
		const e = err as Error
		error = String(e?.message ?? e)
		stack = e?.stack ?? null
	}
	if (options.verbose && entries.length) {
		for (const entry of entries) process.stderr.write(`[mock:${entry.level}] ${entry.text}\n`)
	}
	const createdLayerIds = [...api.scene.layers.keys()].filter((id) => !before.has(id))
	const comp = api.scene.activeComp()
	const boundingBoxes: Record<string, unknown> = {}
	const receiptIds = [...new Set([...createdLayerIds, ...api.scene.selection])].slice(0, 50)
	for (const id of receiptIds) {
		const box = api.scene.boundingBox(id)
		if (box) boundingBoxes[id] = { x: box.x, y: box.y, width: box.width, height: box.height, centre: box.centre }
	}
	const state: Record<string, unknown> = {
		seq: null,
		status: error ? 'error' : 'ok',
		errorStack: stack,
		createdLayerIds,
		activeSelection: [...api.scene.selection],
		compInfo: comp
			? { id: comp.id, name: comp.name, fps: comp.fps, startFrame: comp.startFrame, endFrame: comp.endFrame, resolution: [comp.width, comp.height], width: comp.width, height: comp.height }
			: null,
		boundingBoxes,
		durationMs: 0,
		writtenAt: new Date().toISOString(),
	}
	if (api.scene.diagnostics.length) {
		;(state as Record<string, unknown>).diagnostics = api.scene.diagnostics.slice()
	}
	return { result, error, stack, console: entries, state }
}
