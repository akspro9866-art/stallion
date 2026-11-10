/**
 * Mock `api` — the Cavalry 2.8 scripting surface the automation stack uses,
 * implemented over MockScene. Scope follows the verified API facts recorded
 * in cavalry-mcp (src/legacy.ts header) and the live 2.8 probe: the calls the
 * `_mg` runtime, rig builders, refclone-compiled scripts and the bridge
 * wrapper actually make. Unimplemented calls throw a clear error instead of
 * pretending to succeed.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
	MockScene,
	type MockKeyframe,
	type MockLayer,
} from './scene.ts'
import { isConnectableAttribute, isKnownAttribute } from './schema.ts'
import { encodePng } from './raster.ts'

export interface MockFrameBuffer {
	frame: number
	width: number
	height: number
	rgba: Buffer
}

export interface MockApiOptions {
	homeFolder?: string
	onFrame?: (buffer: MockFrameBuffer) => void
	render?: (scene: MockScene, compId: string, frame: number, width: number, height: number) => { rgba: Buffer; width: number; height: number } | null
}

function fail(message: string): never {
	throw new Error(`mock api: ${message}`)
}

export class MockApi {
	scene: MockScene
	options: MockApiOptions
	lastFrames: MockFrameBuffer[] = []
	#sceneFilePath: string | null = null

	constructor(scene: MockScene, options: MockApiOptions = {}) {
		this.scene = scene
		this.options = options
		scene.createComp()
	}

	// ------------------------------------------------------------- creation

	create(type: string, name?: string, _allowDefaultPreset?: boolean): string {
		return this.scene.createLayer(String(type), name ? String(name) : undefined).id
	}

	primitive(type: string, name: string): string {
		const layer = this.scene.createLayer('basicShape', name)
		this.scene.setAttr(layer, 'generator', `${type}Shape`)
		return layer.id
	}

	/**
	 * Real 2.8 signature: `convertSVGToLayers(filename): string[]`. The mock
	 * parses the SVG's viewBox (or width/height) and one `editableShape` per
	 * `<path d="…">` element — the `d` string becomes `inputPath`, the canvas
	 * size `generator.dimensions`, so bounding boxes are honest without a real
	 * vector renderer. Gradients, transforms and non-path elements are ignored.
	 */
	convertSVGToLayers(filename: string): string[] {
		let text: string
		try {
			text = fs.readFileSync(this.#sandboxPath(filename), 'utf8')
		} catch {
			fail(`convertSVGToLayers: cannot read '${filename}'`)
		}
		const viewBox = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/i.exec(text)
		const width = /<svg[^>]*?\bwidth\s*=\s*["']\s*([\d.]+)/i.exec(text)
		const height = /<svg[^>]*?\bheight\s*=\s*["']\s*([\d.]+)/i.exec(text)
		const dims: [number, number] = viewBox
			? [Number(viewBox[3]) || 100, Number(viewBox[4]) || 100]
			: [Number(width?.[1]) || 100, Number(height?.[1]) || 100]
		const ids: string[] = []
		const paths = [...text.matchAll(/<path\b[^>]*?\bd\s*=\s*["']([^"']+)["']/gi)]
		const shapes = paths.length ? paths : [{ 1: '' }]
		for (const match of shapes) {
			const layer = this.scene.createLayer('editableShape', path.basename(filename, path.extname(filename)))
			this.scene.setAttr(layer, 'inputPath', String(match[1]))
			this.scene.setAttr(layer, 'generator.dimensions', dims)
			ids.push(layer.id)
		}
		return ids
	}

	setGenerator(id: string, attr: string, generatorType: string): void {
		const layer = this.#require(id)
		if (attr !== 'generator') fail(`setGenerator supports the 'generator' attribute, got '${attr}'`)
		this.scene.setAttr(layer, 'generator', generatorType)
	}

	set(id: string, attrs: Record<string, unknown>): void {
		const layer = this.#require(id)
		for (const [attrPath, value] of Object.entries(attrs ?? {})) {
			this.scene.setAttr(layer, attrPath, value)
			// Keep dynamic attribute aliases in step (rawName, array.<name>, dynamic.<name>, uniforms.<name>).
			const rawName = attrPath.replace(/^(array|dynamic|uniforms)\./, '')
			if (layer.dynamicAttrs?.has(rawName) || layer.dynamicAttrs?.has(attrPath)) {
				for (const alias of [rawName, `array.${rawName}`, `dynamic.${rawName}`, `uniforms.${rawName}`]) {
					layer.attrs.set(alias, value)
				}
			}
			// Auto-register uniform attributes declared in SkSL shader/filter source.
			if ((layer.type === 'skslShader' || layer.type === 'skslFilter') && (attrPath === 'code' || attrPath === 'shaderCode') && typeof value === 'string') {
				for (const match of value.matchAll(/\buniform\s+(?:float|int|bool|half\d*|vec\d+|float\d+|mat\d+|shader)\s+([A-Za-z_]\w*)\s*;/g)) {
					const uName = match[1]
					this.addDynamicAttribute(layer.id, 'double', uName)
				}
			}
		}
		this.#syncCompRecord(layer)
	}

	/** Keep the MockComp record in step with compNode attribute writes. */
	#syncCompRecord(layer: MockLayer): void {
		if (layer.type !== 'compNode') return
		const comp = this.scene.comps.get(layer.id)
		if (!comp) return
		const res = this.scene.getAttr(layer, 'resolution')
		if (Array.isArray(res) && res.length >= 2) {
			comp.width = Math.max(1, Math.round(Number(res[0]) || comp.width))
			comp.height = Math.max(1, Math.round(Number(res[1]) || comp.height))
		}
		const fps = this.scene.getAttr(layer, 'fps')
		if (Number.isFinite(Number(fps)) && Number(fps) > 0) comp.fps = Number(fps)
		const bg = this.scene.getAttr(layer, 'backgroundColor')
		if (typeof bg === 'string' && bg) comp.bgColor = bg
		const end = this.scene.getAttr(layer, 'endFrame')
		if (Number.isFinite(Number(end))) {
			comp.endFrame = Math.max(1, Math.round(Number(end)))
			layer.outFrame = comp.endFrame
		}
	}

	get(id: string, attr: string): unknown {
		const layer = this.#require(id)
		return this.scene.getAttr(layer, String(attr))
	}

	// ----------------------------------------------------------- structure

	addDynamic(id: string, typeOrName: string, nameOrType: string, defaultValue?: unknown): string {
		return this.addDynamicAttribute(id, typeOrName, nameOrType, defaultValue)
	}

	addDynamicAttribute(id: string, typeOrName: string, nameOrType: string, defaultValue?: unknown): string {
		const layer = this.#require(id)
		const knownTypes = new Set(['double', 'float', 'int', 'integer', 'bool', 'boolean', 'color', 'string', 'point', 'point2d', 'number'])
		const a = String(typeOrName ?? 'double')
		const b = String(nameOrType ?? 'param')
		const firstIsType = knownTypes.has(a.toLowerCase()) && !knownTypes.has(b.toLowerCase())
		const attrType = firstIsType ? a : b
		const attrName = firstIsType ? b : a
		const rawName = attrName.replace(/^(array|dynamic|uniforms)\./, '')
		if (!layer.dynamicAttrs) layer.dynamicAttrs = new Map()
		const initVal =
			defaultValue !== undefined && !(typeof defaultValue === 'boolean' && attrType !== 'bool' && attrType !== 'boolean')
				? defaultValue
				: attrType === 'color'
					? '#ffffff'
					: attrType === 'string'
						? ''
						: attrType === 'point' || attrType === 'point2d'
							? [0, 0]
							: attrType === 'bool' || attrType === 'boolean'
								? false
								: 0
		for (const alias of [rawName, `array.${rawName}`, `dynamic.${rawName}`, `uniforms.${rawName}`]) {
			layer.dynamicAttrs.set(alias, { type: attrType, name: rawName, defaultValue: initVal })
			if (!layer.attrs.has(alias)) layer.attrs.set(alias, initVal)
		}
		return attrName.includes('.') ? attrName : `dynamic.${rawName}`
	}

	connect(srcId: string, srcAttr: string, dstId: string, dstAttr: string, force?: boolean): void {
		const src = this.#require(srcId)
		const dst = this.#require(dstId)
		const srcDynamic = src.dynamicAttrs?.has(String(srcAttr)) === true
		const dstDynamic = dst.dynamicAttrs?.has(String(dstAttr)) === true
		if (!srcDynamic && !isConnectableAttribute(src.type, String(srcAttr))) {
			this.scene.warn(`connect: unknown source attribute ${src.id}.${srcAttr}`)
		}
		if (!dstDynamic && !isKnownAttribute(dst.type, String(dstAttr)) && !isConnectableAttribute(dst.type, String(dstAttr))) {
			this.scene.warn(`connect: unknown target attribute ${dst.id}.${dstAttr}`)
		}
		this.scene.connect(src.id, String(srcAttr), dst.id, String(dstAttr), force === true)
	}

	parent(id: string, parentId: string): void {
		this.scene.parent(String(id), String(parentId))
	}

	unParent(id: string): void {
		this.scene.parent(String(id), null)
	}

	getParent(id: string): string | null {
		return this.#require(id).parentId
	}

	rename(id: string, name: string): void {
		this.#require(id).name = String(name)
	}

	duplicate(id: string, _withInputConnections?: boolean): string {
		const source = this.#require(id)
		const copy = this.scene.createLayer(source.type, source.name)
		for (const [key, value] of source.attrs) copy.attrs.set(key, value)
		for (const [key, kfs] of source.keyframes) {
			copy.keyframes.set(key, kfs.map((k) => ({ ...k })))
		}
		copy.inFrame = source.inFrame
		copy.outFrame = source.outFrame
		return copy.id
	}

	deleteLayer(id: string): void {
		const layer = this.#require(id)
		for (const comp of this.scene.comps.values()) {
			const index = comp.layerIds.indexOf(layer.id)
			if (index >= 0) comp.layerIds.splice(index, 1)
		}
		this.scene.layers.delete(layer.id)
	}

	// ------------------------------------------------------------ keyframes

	keyframe(id: string, frame: number, attrs: Record<string, unknown>): string {
		return this.scene.keyframe(String(id), frame, attrs ?? {})[0] ?? ''
	}

	magicEasing(id: string, attr: string, frame: number, easing: string, expression?: string): void {
		this.scene.magicEasing(String(id), String(attr), frame, easing, expression)
	}

	modifyKeyframe(id: string, dictionary: Record<string, Record<string, unknown>>): void {
		const layer = this.#require(id)
		for (const [attr, spec] of Object.entries(dictionary ?? {})) {
			const list = layer.keyframes.get(attr)
			if (!list) fail(`modifyKeyframe: '${attr}' is not animated on ${layer.id}`)
			const frame = Math.round(Number((spec as Record<string, unknown>).frame))
			const kf = list.find((k) => k.frame === frame)
			if (!kf) fail(`modifyKeyframe: no keyframe at frame ${frame} on ${layer.id}.${attr}`)
			if ('newFrame' in spec && spec.newFrame != null) kf.frame = Math.round(Number(spec.newFrame))
			if ('newValue' in spec && spec.newValue != null) kf.value = spec.newValue
			if ('type' in spec && spec.type != null) kf.type = Number(spec.type) as MockKeyframe['type']
			list.sort((a, b) => a.frame - b.frame)
		}
	}

	modifyKeyframeTangent(id: string, dictionary: Record<string, Record<string, unknown>>): void {
		const layer = this.#require(id)
		for (const [attr, spec] of Object.entries(dictionary ?? {})) {
			const list = layer.keyframes.get(attr)
			if (!list) fail(`modifyKeyframeTangent: '${attr}' is not animated on ${layer.id}`)
			const frame = Math.round(Number((spec as Record<string, unknown>).frame))
			const kf = list.find((k) => k.frame === frame)
			if (!kf) fail(`modifyKeyframeTangent: no keyframe at frame ${frame} on ${layer.id}.${attr}`)
			kf.type = 0
			const inHandle = spec.inHandle !== false
			const outHandle = spec.outHandle !== false
			// An explicit tangent write overrides any named preset on the segment.
			kf.magicEase = undefined
			if ('angle' in spec && spec.angle != null) {
				const angle = Number(spec.angle)
				if (inHandle) kf.inAngle = angle
				if (outHandle) kf.outAngle = angle
			}
			if ('weight' in spec && spec.weight != null) {
				const weight = Math.max(0, Number(spec.weight))
				if (inHandle) kf.inWeight = weight
				if (outHandle) kf.outWeight = weight
			}
			if ('angleLocked' in spec) kf.magicEase = undefined
			if ('xValue' in spec && spec.xValue != null) {
				const span = Math.abs(Number(spec.xValue) - kf.frame)
				if (inHandle) kf.inWeight = span
				if (outHandle) kf.outWeight = span
			}
		}
	}

	setKeyframeVelocity(id: string, dictionary: Record<string, Record<string, number>>): void {
		const layer = this.#require(id)
		for (const [attr, spec] of Object.entries(dictionary ?? {})) {
			const list = layer.keyframes.get(attr)
			if (!list) fail(`setKeyframeVelocity: '${attr}' is not animated on ${layer.id}`)
			const frame = Math.round(Number((spec as Record<string, unknown>).frame))
			const kf = list.find((k) => k.frame === frame)
			if (!kf) fail(`setKeyframeVelocity: no keyframe at frame ${frame} on ${layer.id}.${attr}`)
			kf.velocity = { ...spec }
		}
	}

	clearKeyframeVelocity(id: string, dictionary: Record<string, { frame: number }>): void {
		const layer = this.#require(id)
		for (const [attr, spec] of Object.entries(dictionary ?? {})) {
			const list = layer.keyframes.get(attr)
			if (!list) continue
			const kf = list.find((k) => k.frame === Math.round(Number(spec.frame)))
			if (kf) delete kf.velocity
		}
	}

	deleteKeyframe(id: string, attr: string, frame: number): void {
		const layer = this.#require(id)
		const list = layer.keyframes.get(String(attr))
		if (!list) return
		const frameNum = Math.round(frame)
		const index = list.findIndex((k) => k.frame === frameNum)
		if (index >= 0) list.splice(index, 1)
	}

	deleteAnimation(id: string, attr: string): void {
		this.#require(id).keyframes.delete(String(attr))
	}

	getKeyframeTimes(id: string, attr: string): number[] {
		const layer = this.#require(id)
		return (layer.keyframes.get(String(attr)) ?? []).map((k) => k.frame)
	}

	getKeyframeIdsForAttribute(id: string, attr: string): string[] {
		const layer = this.#require(id)
		return (layer.keyframes.get(String(attr)) ?? []).map((k) => `${layer.id}:${attr}:${k.frame}`)
	}

	getAnimatedAttributes(id: string): string[] {
		return [...this.#require(id).keyframes.keys()]
	}

	getAttributes(id: string): string[] {
		const layer = this.#require(id)
		const base = ['name', 'id', 'position', 'position.x', 'position.y', 'scale', 'scale.x', 'scale.y', 'rotation', 'opacity', 'pivot', 'hidden']
		return [...new Set([...base, ...layer.attrs.keys(), ...layer.keyframes.keys()])]
	}

	getAttributeDefinition(id: string, attr: string): { name: string; type: string } | null {
		const layer = this.#require(id)
		if (layer.dynamicAttrs?.has(String(attr))) {
			return { name: String(attr), type: layer.dynamicAttrs.get(String(attr))!.type }
		}
		if (!isKnownAttribute(layer.type, String(attr))) return null
		return { name: String(attr), type: 'attribute' }
	}

	// ---------------------------------------------------------- readbacks

	getSelection(_sortByHierarchyOrder?: boolean): string[] {
		return [...this.scene.selection]
	}

	select(ids: string[]): void {
		this.scene.selection = ids.map(String)
	}

	getActiveComp(): string {
		return this.scene.activeComp()?.id ?? ''
	}

	setActiveComp(id: string): void {
		const comp = this.scene.comps.get(String(id))
		if (!comp) fail(`setActiveComp: no comp '${id}'`)
		this.scene.activeCompId = comp.id
	}

	createComp(w?: number, h?: number, fps?: number, endFrame?: number, bgColor?: string): string {
		return this.scene.createComp(w, h, fps, endFrame, bgColor).id
	}

	getCompLayers(topLevel: boolean, compId?: string): string[] {
		return this.scene.compLayers(topLevel === true, compId ? String(compId) : undefined)
	}

	getAllLayerTypes(_topLevel?: boolean): string[] {
		return [...new Set([...this.scene.layers.values()].map((l) => l.type))]
	}

	getLayerType(id: string): string {
		return this.#require(id).type
	}

	getNiceName(id: string): string {
		const layer = this.#require(id)
		return layer.name && layer.name !== layer.type ? layer.name : layer.id
	}

	getFrame(): number {
		return this.scene.frame
	}

	setFrame(frame: number): void {
		this.scene.frame = Math.round(Number(frame))
	}

	getInFrame(id: string): number {
		return this.#require(id).inFrame
	}

	getOutFrame(id: string): number {
		return this.#require(id).outFrame
	}

	setInFrame(id: string, frame: number): void {
		this.#require(id).inFrame = Math.round(Number(frame))
	}

	setOutFrame(id: string, frame: number): void {
		this.#require(id).outFrame = Math.round(Number(frame))
	}

	offsetLayerTime(id: string, delta: number): void {
		const layer = this.#require(id)
		layer.inFrame += Math.round(delta)
		layer.outFrame += Math.round(delta)
	}

	getBoundingBox(id: string, world?: boolean): Record<string, unknown> | null {
		const box = this.scene.boundingBox(String(id))
		if (!box) return null
		// Both spaces report a top-left-origin box. The mock is flat (no nested
		// comp transforms), so comp-space equals world-space; the distinction is
		// still made in the payload so a caller can branch on it as it does live.
		return {
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height,
			centre: box.centre,
			left: box.left,
			right: box.right,
			top: box.top,
			bottom: box.bottom,
			world: world !== false,
		}
	}

	getChildren(id: string): string[] {
		const parentId = String(id)
		return [...this.scene.layers.values()].filter((l) => l.parentId === parentId).map((l) => l.id)
	}

	getRenderQueueItems(): string[] {
		const existing = [...this.scene.layers.values()].filter((l) => l.type === 'renderQueueItem').map((l) => l.id)
		if (existing.length > 0) return existing
		const created = this.scene.createLayer('renderQueueItem', 'Render Queue Item 1')
		this.scene.setAttr(created, 'selected', true)
		return [created.id]
	}

	addRenderQueueItem(_compId?: string): string {
		const created = this.scene.createLayer('renderQueueItem', 'Render Queue Item')
		this.scene.setAttr(created, 'selected', true)
		return created.id
	}

	getJsLogPath(): string {
		return path.join(this.getAppDataFolder(), 'logs', 'js_log.txt')
	}

	appendJsLog(entries: Array<{ level: string; text: string }>): void {
		if (!entries.length) return
		const lines = entries.map((e) => `[${String(e.level).toUpperCase()}] ${e.text}`).join('\n') + '\n'
		for (const target of [this.getJsLogPath(), path.join(this.getAppDataFolder(), 'js_log.txt')]) {
			try {
				fs.mkdirSync(path.dirname(target), { recursive: true })
				fs.appendFileSync(target, lines, 'utf8')
			} catch {
				// Best-effort log persistence in mock sandbox
			}
		}
	}

	getSelectionBoundingBox(): Record<string, number> | null {
		let minX = Infinity
		let minY = Infinity
		let maxX = -Infinity
		let maxY = -Infinity
		for (const id of this.scene.selection) {
			const box = this.scene.boundingBox(id)
			if (!box) continue
			minX = Math.min(minX, box.x)
			minY = Math.min(minY, box.y)
			maxX = Math.max(maxX, box.x + box.width)
			maxY = Math.max(maxY, box.y + box.height)
		}
		if (minX === Infinity) return null
		return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
	}

	getPivotPosition(id: string): { x: number; y: number } {
		const layer = this.#require(id)
		const t = this.scene.worldTransform(layer.id)
		return { x: t.x, y: t.y }
	}

	centrePivot(id: string): void {
		const layer = this.#require(id)
		layer.attrs.set('pivot', [0, 0])
	}

	getInConnectedAttributes(id: string): string[] {
		return this.scene.inConnectedAttributes(String(id))
	}

	/**
	 * Real 2.8 signature: `getInConnection(layerId, attrId): string`, empty string when
	 * the attribute has no input. The scene keeps the richer `${srcId}.${srcAttr}` list,
	 * but the api boundary collapses it to one string so a script written against the
	 * mock cannot pass a shape that Cavalry would never return.
	 */
	getInConnection(id: string, attr: string): string {
		return this.scene.inConnection(String(id), String(attr))[0] ?? ''
	}

	/** Real 2.8 signature: `getOutConnections(layerId, attrId): string[]`. */
	getOutConnections(id: string, attr: string): string[] {
		return this.scene.outConnections(String(id), String(attr)).map((c) => `${c.dstId}.${c.dstAttr}`)
	}

	getOutConnectedAttributes(id: string): string[] {
		const layer = String(id)
		return [...new Set(this.scene.connections.filter((c) => c.srcId === layer).map((c) => c.srcAttr))]
	}

	reorder(id: string, underId: string): void {
		const comp = this.scene.activeComp()
		const layer = this.#require(id)
		if (!comp) return
		const from = comp.layerIds.indexOf(layer.id)
		const to = comp.layerIds.indexOf(String(underId))
		if (from < 0 || to < 0) return
		comp.layerIds.splice(to, 0, comp.layerIds.splice(from, 1)[0])
	}

	// ---------------------------------------------------------------- undo

	startUndoGroup(name: string): void {
		this.scene.startUndoGroup(String(name))
	}

	endUndoGroup(): void {
		this.scene.endUndoGroup()
	}

	startUndo(name = 'Scene Execution'): void {
		this.scene.startUndoGroup(String(name))
	}

	endUndo(): void {
		this.scene.endUndoGroup()
	}

	// ------------------------------------------------------------- rendering

	renderPNGFrame(basePath: string, scalePercent = 100): boolean {
		const comp = this.scene.activeComp()
		if (!comp) fail('renderPNGFrame: no active comp')
		const scale = Math.max(1, Math.min(400, Number(scalePercent) || 100)) / 100
		const width = Math.max(1, Math.round(comp.width * scale))
		const height = Math.max(1, Math.round(comp.height * scale))
		const rendered = this.options.render?.(this.scene, comp.id, this.scene.frame, width, height)
		const rgba = rendered?.rgba ?? Buffer.alloc(width * height * 4)
		this.lastFrames.push({ frame: this.scene.frame, width, height, rgba })
		if (this.lastFrames.length > 64) this.lastFrames.shift()
		if (basePath) {
			const file = /\.[A-Za-z0-9]+$/.test(basePath) ? basePath : `${basePath}.png`
			fs.mkdirSync(path.dirname(file), { recursive: true })
			// A path-only batch must name a real PNG, not a text placeholder.
			// Retain the sidecar for existing pixel tests and inline readbacks.
			fs.writeFileSync(`${file}.rgba`, rgba)
			fs.writeFileSync(file, encodePng(rgba, width, height))
		}
		return true
	}

	// ------------------------------------------------------------- filesystem

	writeToFile(filePath: string, contents: string, _overwrite?: boolean): boolean {
		const file = this.#sandboxPath(filePath)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, String(contents))
		return true
	}

	readFromFile(filePath: string): string {
		return fs.readFileSync(this.#sandboxPath(filePath), 'utf8')
	}

	filePathExists(filePath: string): boolean {
		return fs.existsSync(this.#sandboxPath(filePath))
	}

	getFileSize(filePath: string): number {
		try {
			return fs.statSync(this.#sandboxPath(filePath)).size
		} catch {
			return 0
		}
	}

	makeFolder(folderPath: string): boolean {
		fs.mkdirSync(this.#sandboxPath(folderPath), { recursive: true })
		return true
	}

	getFolderFromPath(filePath: string): string {
		return path.dirname(String(filePath))
	}

	getHomeFolder(): string {
		return this.options.homeFolder ?? path.join(os.tmpdir(), 'stallion-mock-home')
	}

	/** Cavalry's per-host temp folder; the mock keeps it inside the OS temp dir so `#sandboxPath` passes writes through. */
	getTempFolder(): string {
		return path.join(os.tmpdir(), 'stallion-mock-tmp')
	}

	getAppDataFolder(): string {
		return path.join(this.getHomeFolder(), 'AppData')
	}

	getSceneFilePath(): string {
		return this.#sceneFilePath ?? 'mock://scene.cv'
	}

	getCavalryVersion(): string {
		return '2.8.0-mock'
	}

	sceneHasUnsavedChanges(): boolean {
		return false
	}

	/**
	 * Real file-backed checkpoint emulation: writes a full-scene snapshot,
	 * refuses overwrite (like the legacy FILE_EXISTS guard), and re-associates
	 * the session path the way Cavalry's saveSceneAs may. Returns true only
	 * when the file actually landed.
	 */
	saveSceneAs(filePath: string): boolean {
		const file = this.#sandboxPath(filePath)
		if (fs.existsSync(file)) return false
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, this.scene.checkpointSnapshot())
		this.#sceneFilePath = file
		return true
	}

	/** Restore a checkpoint written by saveSceneAs; missing/invalid files return false. */
	openScene(filePath: string, _discardUnsaved?: boolean): boolean {
		const file = this.#sandboxPath(filePath)
		let snapshot: string
		try {
			snapshot = fs.readFileSync(file, 'utf8')
		} catch {
			return false
		}
		try {
			this.scene.restoreCheckpoint(snapshot)
		} catch {
			return false
		}
		this.#sceneFilePath = file
		return true
	}

	// ------------------------------------------------------------------ misc

	layerExists(id: string): boolean {
		return this.scene.layer(id) !== null
	}

	#require(id: string): MockLayer {
		const layer = this.scene.layer(id)
		if (!layer) fail(`no layer '${id}'`)
		return layer
	}

	/** Keep file writes inside the mock home unless the caller passed a tmp path. */
	#sandboxPath(filePath: string): string {
		const resolved = path.resolve(String(filePath))
		const home = path.resolve(this.getHomeFolder())
		const tmp = path.resolve(os.tmpdir())
		if (resolved.startsWith(home) || resolved.startsWith(tmp)) return resolved
		return path.join(home, 'files', resolved.replace(/^([A-Za-z]:)?[\\/]+/, ''))
	}
}
