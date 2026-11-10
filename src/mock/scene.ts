/**
 * In-memory Cavalry scene graph for the mock bridge.
 *
 * The mock models the parts of Cavalry 2.8 the automation stack actually
 * touches: comps, layers with typed attributes, parent/deformer links,
 * connections, per-attribute keyframes with linear / weighted cubic Bézier /
 * named-preset interpolation, undo groups, the playhead and the render
 * raster. Incoming calls are validated against schema.ts; unknown node types
 * or attribute paths become diagnostics on the scene instead of silent
 * mutations. Everything is deterministic for a given call sequence — no
 * clocks, no randomness beyond the seeded id counters.
 */

import { isKnownAttribute, nodeDef, NODE_TYPES, type AttrDef } from './schema.ts'

export interface MockKeyframe {
	frame: number
	value: unknown
	/** 0 Bezier, 1 Linear, 2 Step */
	type: 0 | 1 | 2
	magicEase?: string
	inAngle?: number
	inWeight?: number
	outAngle?: number
	outWeight?: number
	velocity?: Record<string, number>
}

export interface MockLayer {
	id: string
	type: string
	name: string
	parentId: string | null
	attrs: Map<string, unknown>
	keyframes: Map<string, MockKeyframe[]>
	dynamicAttrs?: Map<string, { type: string; name: string; defaultValue?: unknown }>
	deformerIds: string[]
	shaderIds?: string[]
	filterIds?: string[]
	inFrame: number
	outFrame: number
}

export interface MockConnection {
	srcId: string
	srcAttr: string
	dstId: string
	dstAttr: string
}

export interface MockComp {
	id: string
	name: string
	fps: number
	width: number
	height: number
	startFrame: number
	endFrame: number
	bgColor: string
	layerIds: string[]
}

export interface SceneDiagnostic {
	level: 'warn' | 'error'
	text: string
}

export const EASE_CURVES: Record<string, [number, number, number, number]> = {
	None: [0, 0, 1, 1],
	SlowIn: [0.42, 0, 1, 1],
	SlowOut: [0, 0, 0.58, 1],
	SlowInSlowOut: [0.42, 0, 0.58, 1],
	VerySlowIn: [0.76, 0, 1, 1],
	VerySlowOut: [0, 0, 0.24, 1],
	VerySlowInVerySlowOut: [0.76, 0, 0.24, 1],
	SpringIn: [0.64, 0, 0.78, 0.4],
	SpringOut: [0.22, 1.4, 0.36, 1],
	SpringInSpringOut: [0.5, 1.4, 0.5, 0.4],
	AnticipateIn: [0.36, 0, 0.66, -0.56],
	OvershootOut: [0.34, 1.56, 0.64, 1],
	AnticipateInOvershootOut: [0.5, -0.4, 0.5, 1.4],
	BounceOut: [0.34, 1.56, 0.64, 1],
}

export const EASE_ALIASES: Record<string, string> = {
	QuarticIn: 'SlowIn',
	QuarticOut: 'SlowOut',
	QuarticInOut: 'SlowInSlowOut',
	CubicIn: 'SlowIn',
	CubicOut: 'SlowOut',
	CubicInOut: 'SlowInSlowOut',
	ExpoIn: 'VerySlowIn',
	ExpoOut: 'VerySlowOut',
	ExpoInOut: 'VerySlowInVerySlowOut',
	BackIn: 'AnticipateIn',
	BackOut: 'OvershootOut',
	BackInOut: 'AnticipateInOvershootOut',
	Linear: 'None',
}

function cubicBezierY(p: [number, number, number, number], t: number): number {
	const [, y1, , y2] = p
	const u = 1 - t
	return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
}

function cubicBezierX(p: [number, number, number, number], t: number): number {
	const [x1, , x2] = p
	const u = 1 - t
	return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t
}

/** Solve a unit cubic-bezier preset by bisection on x(t) — deterministic. */
export function sampleEase(name: string, t: number): number {
	const alias = EASE_ALIASES[name]
	const curve = EASE_CURVES[alias ?? name] ?? EASE_CURVES.SlowInSlowOut
	let lo = 0
	let hi = 1
	let x = t
	for (let i = 0; i < 24; i++) {
		x = (lo + hi) / 2
		if (cubicBezierX(curve, x) < t) lo = x
		else hi = x
	}
	return cubicBezierY(curve, x)
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

function asPoint(value: unknown): [number, number] | null {
	if (Array.isArray(value) && value.length >= 2) return [Number(value[0]) || 0, Number(value[1]) || 0]
	if (value && typeof value === 'object') {
		const v = value as Record<string, unknown>
		if ('x' in v && 'y' in v) return [Number(v.x) || 0, Number(v.y) || 0]
	}
	return null
}

/** FNV-1a dual-lane digest — mirrors the live bridge receipt (Receipt.ts). */
export function sceneDigest(input: string): string {
	let hi = 0x811c9dc5
	let lo = 0x1b873593
	for (let i = 0; i < input.length; i++) {
		const ch = input.charCodeAt(i)
		hi = Math.imul((hi ^ (ch & 0xff)) >>> 0, 0x01000193) >>> 0
		lo = Math.imul((lo ^ ((ch >>> 8) & 0xff)) >>> 0, 0x01000193) >>> 0
	}
	const hex = (n: number) => {
		let out = ''
		for (let s = 28; s >= 0; s -= 4) out += ((n >>> s) & 0xf).toString(16)
		return out
	}
	return hex(hi) + hex(lo)
}

export interface MockSceneOptions {
	strictSchema?: boolean
}

export class MockScene {
	comps = new Map<string, MockComp>()
	layers = new Map<string, MockLayer>()
	connections: MockConnection[] = []
	selection: string[] = []
	activeCompId: string | null = null
	frame = 0
	diagnostics: SceneDiagnostic[] = []
	/** Layers created inside the most recently closed undo group. */
	lastUndo: { name: string; createdLayerIds: string[] } | null = null
	strictSchema: boolean
	private counters = new Map<string, number>()
	private undoDepth = 0
	private undoCreated: string[] = []
	private compCounter = 0

	constructor(options: MockSceneOptions = {}) {
		this.strictSchema = options.strictSchema !== false
	}

	diag(level: SceneDiagnostic['level'], text: string): void {
		this.diagnostics.push({ level, text })
	}

	warn(text: string): void {
		this.diag('warn', text)
	}

	private nextId(type: string): string {
		const n = (this.counters.get(type) ?? 0) + 1
		this.counters.set(type, n)
		return `${type}#${n}`
	}

	private ensureComp(): MockComp {
		if (this.activeCompId && this.comps.has(this.activeCompId)) return this.comps.get(this.activeCompId)!
		return this.createComp()
	}

	createComp(w = 1920, h = 1080, fps = 24, endFrame = 215, bgColor = '#000000'): MockComp {
		this.compCounter += 1
		const comp: MockComp = {
			id: `compNode#${this.compCounter}`,
			name: `Comp ${this.compCounter}`,
			fps,
			width: Math.max(1, Math.round(w)),
			height: Math.max(1, Math.round(h)),
			startFrame: 0,
			endFrame: Math.max(1, Math.round(endFrame)),
			bgColor,
			layerIds: [],
		}
		this.comps.set(comp.id, comp)
		// Register the comp as a settable compNode layer so api.set/get on the
		// comp id works (resolution, fps, background) without appearing in the
		// layer list.
		this.layers.set(comp.id, {
			id: comp.id,
			type: 'compNode',
			name: comp.name,
			parentId: null,
			attrs: new Map(),
			keyframes: new Map(),
			deformerIds: [],
			inFrame: comp.startFrame,
			outFrame: comp.endFrame,
		})
		if (!this.activeCompId) this.activeCompId = comp.id
		return comp
	}

	activeComp(): MockComp | null {
		return this.activeCompId ? this.comps.get(this.activeCompId) ?? null : null
	}

	createLayer(type: string, name?: string): MockLayer {
		const comp = this.ensureComp()
		const known = type in NODE_TYPES
		if (!known) this.warn(`create: unknown node type '${type}' — created as generic node`)
		const layer: MockLayer = {
			id: this.nextId(type),
			type,
			name: name ?? `${type}`,
			parentId: null,
			attrs: new Map(),
			keyframes: new Map(),
			dynamicAttrs: new Map(),
			deformerIds: [],
			shaderIds: [],
			filterIds: [],
			inFrame: 0,
			outFrame: comp.endFrame,
		}
		this.layers.set(layer.id, layer)
		comp.layerIds.push(layer.id)
		if (this.undoDepth > 0) this.undoCreated.push(layer.id)
		return layer
	}

	layer(id: string): MockLayer | null {
		return this.layers.get(String(id)) ?? null
	}

	/** z-order = creation order; topLevel excludes layers with a parent. */
	compLayers(topLevel: boolean, compId?: string): string[] {
		const comp = compId ? this.comps.get(compId) : this.activeComp()
		if (!comp) return []
		return comp.layerIds.filter((id) => {
			const layer = this.layers.get(id)
			if (!layer) return false
			return topLevel ? layer.parentId === null : true
		})
	}

	// ---------------------------------------------------------------- attrs

	static attrKind(type: string, path: string): AttrDef | null {
		const def = nodeDef(type)
		return def.attributes[path] ?? null
	}

	setAttr(layer: MockLayer, path: string, value: unknown): boolean {
		const isDynamic = layer.dynamicAttrs?.has(path) === true
		if (!isDynamic && !isKnownAttribute(layer.type, path)) {
			const message = `set: unknown attribute path '${path}' on ${layer.type}`
			if (this.strictSchema) {
				this.warn(message + ' (not applied)')
				return false
			}
			this.warn(message + ' (applied anyway)')
		}
		// autokey: a static set on an already-animated attribute keyframes at the playhead
		if (layer.keyframes.has(path) && layer.keyframes.get(path)!.length > 0) {
			this.keyframe(layer.id, this.frame, { [path]: value })
			return true
		}
		const pointMatch = /^(.*)\.(x|y)$/.exec(path)
		if (pointMatch) {
			const parent = pointMatch[1]
			const current = asPoint(layer.attrs.get(parent) ?? MockScene.attrKind(layer.type, parent)?.default)
			if (current) {
				const next: [number, number] = [current[0], current[1]]
				next[pointMatch[2] === 'x' ? 0 : 1] = Number(value) || 0
				layer.attrs.set(parent, next)
				return true
			}
		}
		layer.attrs.set(path, value)
		return true
	}

	getAttr(layer: MockLayer, path: string, visited?: Set<string>): unknown {
		const visitKey = `${layer.id}.${path}`
		if (!visited?.has(visitKey)) {
			const incoming = this.connections.find((c) => c.dstId === layer.id && c.dstAttr === path)
			if (incoming) {
				const srcLayer = this.layer(incoming.srcId)
				if (srcLayer) {
					const nextVisited = new Set(visited)
					nextVisited.add(visitKey)
					if (incoming.srcAttr !== 'id') {
						const propagated = this.getAttr(srcLayer, incoming.srcAttr, nextVisited)
						if (propagated !== undefined) return propagated
					} else if (srcLayer.type === 'value' || srcLayer.type === 'value2') {
						const propagated = this.getAttr(srcLayer, 'value', nextVisited)
						if (propagated !== undefined) return propagated
					} else if (srcLayer.type === 'valueBlend') {
						const valA = this.getAttr(srcLayer, 'a', nextVisited)
						const valB = this.getAttr(srcLayer, 'b', nextVisited)
						const weightRaw = Number(this.getAttr(srcLayer, 'weight', nextVisited))
						const t = Number.isFinite(weightRaw) ? Math.max(0, Math.min(1, weightRaw / 100)) : 0.5
						if (typeof valA === 'number' && typeof valB === 'number') return lerp(valA, valB, t)
						const ptA = asPoint(valA)
						const ptB = asPoint(valB)
						if (ptA && ptB) return [lerp(ptA[0], ptB[0], t), lerp(ptA[1], ptB[1], t)]
					}
				}
			}
		}
		if (layer.keyframes.has(path)) {
			const kfs = layer.keyframes.get(path)!
			if (kfs.length > 0) return this.evaluate(layer, path, this.frame)
		}
		const compound = this.evaluateCompoundPoint(layer, path)
		if (compound) return compound
		if (layer.attrs.has(path)) return layer.attrs.get(path)
		if (layer.dynamicAttrs?.has(path)) {
			const dyn = layer.dynamicAttrs.get(path)!
			if (dyn.defaultValue !== undefined) return dyn.defaultValue
		}
		const pointMatch = /^(.*)\.(x|y)$/.exec(path)
		if (pointMatch) {
			const parentValue = this.getAttr(layer, pointMatch[1], visited)
			const pt = asPoint(parentValue)
			if (pt) return pt[pointMatch[2] === 'x' ? 0 : 1]
		}
		const def = MockScene.attrKind(layer.type, path)
		return def ? def.default : undefined
	}

	/** A point attribute assembled from static value + per-axis keyframes. */
	evaluateCompoundPoint(layer: MockLayer, path: string): [number, number] | null {
		const hasAxis = layer.keyframes.has(`${path}.x`) || layer.keyframes.has(`${path}.y`)
		if (!hasAxis) return null
		const kind = MockScene.attrKind(layer.type, path)
		const base = asPoint(layer.attrs.get(path) ?? kind?.default) ?? [0, 0]
		const xList = layer.keyframes.get(`${path}.x`)
		const yList = layer.keyframes.get(`${path}.y`)
		const x = xList && xList.length ? this.evaluate(layer, `${path}.x`, this.frame) : base[0]
		const y = yList && yList.length ? this.evaluate(layer, `${path}.y`, this.frame) : base[1]
		return [Number(x) || 0, Number(y) || 0]
	}

	// ----------------------------------------------------------- evaluator

	/** Interpolate one attribute path at a frame: linear, Bézier or preset. */
	evaluate(layer: MockLayer, path: string, frame: number): unknown {
		const kfs = layer.keyframes.get(path)
		if (!kfs || kfs.length === 0) return this.getStaticValue(layer, path)
		const sorted = kfs
		if (frame <= sorted[0].frame) return sorted[0].value
		if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value
		let index = 0
		for (let i = 0; i < sorted.length - 1; i++) {
			if (frame >= sorted[i].frame && frame <= sorted[i + 1].frame) {
				index = i
				break
			}
		}
		const a = sorted[index]
		const b = sorted[index + 1]
		const va = a.value
		const vb = b.value
		if (typeof va !== 'number' || typeof vb !== 'number') {
			const pa = asPoint(va)
			const pb = asPoint(vb)
			if (!pa || !pb) return frame - a.frame <= b.frame - frame ? va : vb
			const span = b.frame - a.frame || 1
			const t = (frame - a.frame) / span
			const eased = MockScene.segmentWeight(a, b, t)
			return [lerp(pa[0], pb[0], eased), lerp(pa[1], pb[1], eased)]
		}
		const span = b.frame - a.frame || 1
		const t = (frame - a.frame) / span
		return lerp(va, vb, MockScene.segmentWeight(a, b, t))
	}

	/** Progress 0..1 across the a→b segment under the a keyframe's interpolation. */
	static segmentWeight(a: MockKeyframe, b: MockKeyframe, t: number): number {
		if (a.type === 2) return 0
		if (a.type === 1) return t
		if (a.magicEase) return sampleEase(a.magicEase, t)
		// weighted cubic Bézier from tangent handles; weight is in frames
		const span = Math.max(b.frame - a.frame, 1e-6)
		const outW = Math.min(Math.max(a.outWeight ?? span / 3, 0), span)
		const inW = Math.min(Math.max(b.inWeight ?? span / 3, 0), span)
		const tanOut = Math.tan(((((a.outAngle ?? 0) % 360) + 360) % 360) * (Math.PI / 180))
		const tanIn = Math.tan(((((b.inAngle ?? 0) % 360) + 360) % 360) * (Math.PI / 180))
		const p1x = outW / span
		const p1y = (tanOut * outW) / span
		const p2x = 1 - inW / span
		const p2y = 1 - (tanIn * inW) / span
		let lo = 0
		let hi = 1
		let s = t
		for (let i = 0; i < 24; i++) {
			s = (lo + hi) / 2
			const u = 1 - s
			const x = 3 * u * u * s * p1x + 3 * u * s * s * p2x + s * s * s
			if (x < t) lo = s
			else hi = s
		}
		const u = 1 - s
		const y = 3 * u * u * s * p1y + 3 * u * s * s * p2y + s * s * s
		return y
	}

	private getStaticValue(layer: MockLayer, path: string): unknown {
		if (layer.attrs.has(path)) return layer.attrs.get(path)
		const pointMatch = /^(.*)\.(x|y)$/.exec(path)
		if (pointMatch) {
			const pt = asPoint(this.getStaticValue(layer, pointMatch[1]))
			if (pt) return pt[pointMatch[2] === 'x' ? 0 : 1]
		}
		return MockScene.attrKind(layer.type, path)?.default
	}

	// ------------------------------------------------------------- keyframes

	keyframe(layerId: string, frame: number, attrs: Record<string, unknown>): string[] {
		const layer = this.layer(layerId)
		if (!layer) {
			this.warn(`keyframe: no layer '${layerId}'`)
			return []
		}
		const ids: string[] = []
		for (const [path, value] of Object.entries(attrs)) {
			const list = layer.keyframes.get(path) ?? []
			const frameNum = Math.round(frame)
			const existing = list.find((k) => k.frame === frameNum)
			if (existing) existing.value = value
			else list.push({ frame: frameNum, value, type: 1 })
			list.sort((x, y) => x.frame - y.frame)
			layer.keyframes.set(path, list)
			ids.push(`${layer.id}:${path}:${frameNum}`)
		}
		return ids
	}

	magicEasing(layerId: string, attr: string, frame: number, easing: string, _expression?: string): void {
		const layer = this.layer(layerId)
		if (!layer) return
		const list = layer.keyframes.get(attr) ?? []
		const frameNum = Math.round(frame)
		const kf = list.find((k) => k.frame === frameNum)
		if (!kf) {
			this.warn(`magicEasing: no keyframe at frame ${frameNum} on ${layer.id}.${attr}`)
			return
		}
		kf.magicEase = easing
		kf.type = 0
	}

	// ------------------------------------------------------------ structure

	connect(srcId: string, srcAttr: string, dstId: string, dstAttr: string, force = false): void {
		const src = this.layer(srcId)
		const dst = this.layer(dstId)
		if (!src || !dst) {
			this.warn(`connect: missing endpoint ${!src ? srcId : dstId}`)
			return
		}
		const existing = this.connections.find((c) => c.dstId === dst.id && c.dstAttr === dstAttr)
		if (existing && !force) {
			this.warn(`connect: ${dst.id}.${dstAttr} already connected from ${existing.srcId}.${existing.srcAttr} (use force)`)
			return
		}
		if (existing) this.connections.splice(this.connections.indexOf(existing), 1)
		this.connections.push({ srcId: src.id, srcAttr, dstId: dst.id, dstAttr })
		const deformerMatch = /^(deformers)\.?/.exec(dstAttr)
		if (deformerMatch && !dst.deformerIds.includes(src.id)) dst.deformerIds.push(src.id)
		if (/^material\.(shader|colorShaders)\b/.test(dstAttr)) {
			if (!dst.shaderIds) dst.shaderIds = []
			if (!dst.shaderIds.includes(src.id)) dst.shaderIds.push(src.id)
		}
		if (/^filters\b/.test(dstAttr)) {
			if (!dst.filterIds) dst.filterIds = []
			if (!dst.filterIds.includes(src.id)) dst.filterIds.push(src.id)
		}
	}

	inConnectedAttributes(id: string): string[] {
		return [...new Set(this.connections.filter((c) => c.dstId === id).map((c) => c.dstAttr))]
	}

	inConnection(id: string, attr: string): string[] {
		return this.connections.filter((c) => c.dstId === id && c.dstAttr === attr).map((c) => `${c.srcId}.${c.srcAttr}`)
	}

	outConnections(id: string, attr: string): Array<{ dstId: string; dstAttr: string }> {
		return this.connections.filter((c) => c.srcId === id && c.srcAttr === attr).map((c) => ({ dstId: c.dstId, dstAttr: c.dstAttr }))
	}

	parent(childId: string, parentId: string | null): void {
		const child = this.layer(childId)
		if (!child) return
		if (parentId === null) {
			child.parentId = null
			return
		}
		const parent = this.layer(parentId)
		if (!parent) {
			this.warn(`parent: no layer '${parentId}'`)
			return
		}
		if (childId === parentId) return
		child.parentId = parent.id
	}

	worldTransform(layerId: string): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
		const layer = this.layer(layerId)
		if (!layer) return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
		const pos = asPoint(this.getAttr(layer, 'position')) ?? [0, 0]
		const scale = asPoint(this.getAttr(layer, 'scale')) ?? [100, 100]
		const normScale = (s: number): number => (Math.abs(s) > 0 && Math.abs(s) <= 10 ? s : s / 100)
		const sxLocal = normScale(scale[0])
		const syLocal = normScale(scale[1])
		const rotation = Number(this.getAttr(layer, 'rotation')) || 0
		if (!layer.parentId) {
			return { x: pos[0], y: pos[1], scaleX: sxLocal, scaleY: syLocal, rotation }
		}
		const parentT = this.worldTransform(layer.parentId)
		const rad = (parentT.rotation * Math.PI) / 180
		const cos = Math.cos(rad)
		const sin = Math.sin(rad)
		const sx = pos[0] * parentT.scaleX
		const sy = pos[1] * parentT.scaleY
		return {
			x: parentT.x + sx * cos - sy * sin,
			y: parentT.y + sx * sin + sy * cos,
			scaleX: parentT.scaleX * sxLocal,
			scaleY: parentT.scaleY * syLocal,
			rotation: parentT.rotation + rotation,
		}
	}

	/** World-space axis-aligned bounding box, matching the live centre convention. */
	boundingBox(layerId: string): {
		x: number
		y: number
		width: number
		height: number
		centre: { x: number; y: number }
		left: number
		right: number
		top: number
		bottom: number
	} | null {
		const layer = this.layer(layerId)
		if (!layer) return null
		const def = nodeDef(layer.type)
		if (!def.visual) return null
		const hasExplicitDims = layer.attrs.has('generator.dimensions') || layer.keyframes.has('generator.dimensions') || layer.keyframes.has('generator.dimensions.x') || layer.keyframes.has('generator.dimensions.y')
		const dims = hasExplicitDims ? (asPoint(this.getAttr(layer, 'generator.dimensions')) ?? this.visualSize(layer)) : this.visualSize(layer)
		const t = this.worldTransform(layerId)
		const w = Math.abs(dims[0] * t.scaleX)
		const h = Math.abs(dims[1] * t.scaleY)
		const rad = (t.rotation * Math.PI) / 180
		const cos = Math.abs(Math.cos(rad))
		const sin = Math.abs(Math.sin(rad))
		const extX = w * cos + h * sin
		const extY = w * sin + h * cos
		const pivot = asPoint(this.getAttr(layer, 'pivot')) ?? [0, 0]
		const cx = t.x - pivot[0] * t.scaleX
		const cy = t.y - pivot[1] * t.scaleY
		const left = cx - extX / 2
		const right = cx + extX / 2
		const top = cy - extY / 2
		const bottom = cy + extY / 2
		return {
			x: left,
			y: top,
			width: extX,
			height: extY,
			centre: { x: cx, y: cy },
			left,
			right,
			top,
			bottom,
		}
	}

	private visualSize(layer: MockLayer): [number, number] {
		const textBox = asPoint(this.getAttr(layer, 'textBoxSize'))
		if (layer.type === 'textShape') {
			const text = String(this.getAttr(layer, 'text') ?? '')
			const size = Number(this.getAttr(layer, 'fontSize')) || 24
			if (textBox && textBox[0] > 0 && textBox[1] > 0) return textBox
			return [Math.max(1, text.length) * size * 0.55, size * 1.2]
		}
		if (layer.attrs.has('generator.radius') || layer.attrs.has('radius')) {
			const rKey = layer.attrs.has('generator.radius') ? 'generator.radius' : 'radius'
			const rRaw = this.getAttr(layer, rKey)
			if (typeof rRaw === 'number' && Number.isFinite(rRaw) && rRaw > 0) {
				return [rRaw * 2, rRaw * 2]
			}
			const rPt = asPoint(rRaw)
			if (rPt && (rPt[0] > 0 || rPt[1] > 0)) {
				return [Math.abs(rPt[0]) * 2, Math.abs(rPt[1]) * 2]
			}
		}
		const genDims = asPoint(this.getAttr(layer, 'generator.dimensions'))
		if (genDims && genDims[0] > 0 && genDims[1] > 0) return genDims
		if (textBox && textBox[0] > 0 && textBox[1] > 0) return textBox
		return [100, 100]
	}

	// ----------------------------------------------------------------- undo

	startUndoGroup(name: string): void {
		this.undoDepth += 1
		if (this.undoDepth === 1) {
			this.undoCreated = []
			this.lastUndo = { name, createdLayerIds: [] }
		}
	}

	endUndoGroup(): void {
		if (this.undoDepth === 0) return
		this.undoDepth -= 1
		if (this.undoDepth === 0 && this.lastUndo) {
			this.lastUndo.createdLayerIds = [...this.undoCreated]
			this.undoCreated = []
		}
	}

	// ------------------------------------------------------ scene checkpoint

	/** JSON-safe full-scene snapshot backing the mock saveSceneAs/openScene pair. */
	checkpointSnapshot(): string {
		return JSON.stringify({
			comps: [...this.comps.values()],
			layers: [...this.layers.values()].map((l) => ({ ...l, attrs: [...l.attrs.entries()], keyframes: [...l.keyframes.entries()] })),
			connections: this.connections,
			selection: this.selection,
			activeCompId: this.activeCompId,
			frame: this.frame,
			lastUndo: this.lastUndo,
			counters: [...this.counters.entries()],
			compCounter: this.compCounter,
		})
	}

	/** Restore a snapshot produced by checkpointSnapshot; unknown shapes throw. */
	restoreCheckpoint(snapshot: string): void {
		const data = JSON.parse(snapshot) as {
			comps: MockComp[]
			layers: Array<Omit<MockLayer, 'attrs' | 'keyframes'> & { attrs: [string, unknown][]; keyframes: [string, MockKeyframe[]][] }>
			connections: MockConnection[]
			selection: string[]
			activeCompId: string | null
			frame: number
			lastUndo: { name: string; createdLayerIds: string[] } | null
			counters: [string, number][]
			compCounter: number
		}
		if (!Array.isArray(data.comps) || !Array.isArray(data.layers)) throw new Error('invalid scene checkpoint')
		this.comps = new Map(data.comps.map((c) => [c.id, c]))
		this.layers = new Map(
			data.layers.map((l) => [
				l.id,
				{
					...l,
					attrs: new Map(l.attrs),
					keyframes: new Map(l.keyframes),
					dynamicAttrs: new Map(),
					shaderIds: l.shaderIds ?? [],
					filterIds: l.filterIds ?? [],
				},
			]),
		)
		this.connections = data.connections
		this.selection = data.selection
		this.activeCompId = data.activeCompId
		this.frame = data.frame
		this.lastUndo = data.lastUndo
		this.counters = new Map(data.counters)
		this.compCounter = data.compCounter
		this.undoDepth = 0
		this.undoCreated = []
	}

	// ---------------------------------------------------------------- state

	/** Canonical digest input: node ids+types+keyframe counts, then connections. */
	facts(): { layers: Array<{ id: string; type: string; keyframes: number }>; connections: string[] } {
		const layers: Array<{ id: string; type: string; keyframes: number }> = []
		for (const comp of this.comps.values()) {
			for (const id of comp.layerIds) {
				const layer = this.layers.get(id)
				if (!layer) continue
				let count = 0
				for (const kfs of layer.keyframes.values()) count += kfs.length
				layers.push({ id: layer.id, type: layer.type, keyframes: count })
			}
		}
		layers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		const connections = this.connections
			.map((c) => `${c.dstId}<-${c.dstAttr}`)
			.sort()
		return { layers, connections }
	}

	sceneStateHash(): string {
		const parts = this.facts().layers.map((l) => `${l.id}:${l.type}@k=${l.keyframes}`)
		return sceneDigest(`nodes(${parts.join(';')})conn(${this.facts().connections.join(';')})`)
	}
}
