/**
 * Deterministic mock receipt (sceneStateHash / consoleDiagnostics / beatBBoxes) (extracted from mock/server.ts; behaviour unchanged).
 */

import { MockScene, sceneDigest } from './scene.ts'

export interface ConsoleEntry {
	level: string
	text: string
}

/** Deterministic receipt for the current scene state. */
export function buildReceipt(scene: MockScene, consoleEntries: ConsoleEntry[], receiptIds: string[], beatFrames: number[]): Record<string, unknown> {
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
