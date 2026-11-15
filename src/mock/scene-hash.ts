/**
 * Fast deterministic scene-tree checksum for the mock bridge.
 *
 * Computes an FNV-1a digest over the ACTIVE composition only — layer ids in
 * hierarchy order plus the destination/target endpoints and current values of
 * every connected (behaviour) attribute — without ever serializing the full
 * scene graph over HTTP. The digest is hex string (`fnv1a-32-64`, 16 hex
 * chars) matching the dual-lane FNV-1a receipt digest in `scene.ts`.
 */

import type { MockApi } from './api.ts'
import type { MockScene } from './scene.ts'
import { sceneDigest } from './scene.ts'

export const SCENE_HASH_ALGORITHM = 'fnv1a-32x2'

/** Stable value serialization: numbers to fixed precision, arrays flattened, objects key-sorted. */
function stableValue(value: unknown): string {
	if (value === null || value === undefined) return 'null'
	if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : String(value)
	if (typeof value === 'string') return JSON.stringify(value)
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableValue(v)}`).join(',')}}`
	}
	return String(value)
}

/**
 * Digest input over the active comp: `comp(<id>)` then `layers(<id1>,<id2>,...)`
 * in hierarchy order, then one `link(<dstId>.<dstAttr><-<srcId>.<srcAttr>=<value>)`
 * entry per connection whose destination lives in the active comp. Connection
 * entries are emitted in scene insertion order (deterministic for a fixed scene).
 */
export function sceneHashFacts(api: MockApi, scene: MockScene): string {
	const comp = scene.activeComp()
	const layerIds = api.getCompLayers(false)
	const parts: string[] = [`comp(${comp ? comp.id : ''})`, `layers(${layerIds.join(',')})`]
	for (const layerId of layerIds) {
		for (const dstAttr of scene.inConnectedAttributes(layerId)) {
			for (const src of scene.inConnection(layerId, dstAttr)) {
				const value = api.get(layerId, dstAttr)
				parts.push(`link(${layerId}.${dstAttr}<-${src}=${stableValue(value)})`)
			}
		}
	}
	return parts.join(';')
}

export interface SceneHashResult {
	hash: string
	algorithm: string
	compId: string
	layerCount: number
	connectionCount: number
}

/** Compute the fast scene checksum for the mock's active composition. */
export function computeSceneHash(api: MockApi, scene: MockScene): SceneHashResult {
	const comp = scene.activeComp()
	const facts = sceneHashFacts(api, scene)
	const layerIds = api.getCompLayers(false)
	let connectionCount = 0
	for (const layerId of layerIds) connectionCount += scene.inConnectedAttributes(layerId).length
	return {
		hash: sceneDigest(facts),
		algorithm: SCENE_HASH_ALGORITHM,
		compId: comp ? comp.id : '',
		layerCount: layerIds.length,
		connectionCount,
	}
}
