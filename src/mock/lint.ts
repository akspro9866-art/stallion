/**
 * Static scene-graph lint for the mock bridge (vision-free pre-render gate).
 *
 * Port of xiaoma-studio `engine/lint.mjs` from pixels to the in-memory scene
 * graph, matching the three checks that do not need a screenshot:
 *
 *   1. WCAG contrast — every visible text layer is compared against the solid
 *      colour behind it (covering layer below it in z-order, else comp bg):
 *      body text needs >= 4.5:1, large text (>= 24 px) >= 3:1.
 *   2. AABB overlap — two visible text blocks whose intersection covers more
 *      than 25% of the smaller box collide (a previous scene's title that
 *      never left). Shapes and decorative layers may overlap freely.
 *   3. Title-safe clipping — a text box must stay inside the central 90% of
 *      the comp (5% margin per side, broadcast title-safe).
 *
 * The report samples the comp at 0/25/50/75/100% by default (or at explicit
 * beat frames), never mutates the caller's playhead, and is deterministic:
 * layers are walked in comp order, numbers are rounded, and findings are
 * deduped per rule + layer pair with every offending frame listed.
 */

import type { MockLayer, MockScene } from './scene.ts'

export const SCENE_LINT_BODY_CONTRAST = 4.5
export const SCENE_LINT_LARGE_CONTRAST = 3
export const SCENE_LINT_LARGE_TEXT_PX = 24
/** Title-safe is the central 90% of the frame: 5% margin per side. */
export const SCENE_LINT_TITLE_SAFE_MARGIN = 0.05
export const SCENE_LINT_OVERLAP_RATIO = 0.25
export const SCENE_LINT_SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const
/** Opacity below this reads as a decorative watermark, like the upstream lint. */
const MIN_READABLE_OPACITY = 0.6
const MIN_TEXT_LENGTH = 2

export type SceneLintRule = 'contrast' | 'overlap' | 'title-safe'

export interface SceneLintFinding {
	rule: SceneLintRule
	level: 'warn' | 'error'
	/** Layer ids involved, in comp order. */
	layers: string[]
	/** Every sampled frame where the violation occurs. */
	frames: number[]
	detail: string
}

export interface SceneLintReport {
	passed: boolean
	compId: string | null
	frames: number[]
	checked: { frames: number; textLayers: number }
	findings: SceneLintFinding[]
	counts: Record<SceneLintRule, number>
}

export interface SceneLintOptions {
	/** Explicit frames to sample; defaults to fractions of the comp range. */
	frames?: number[]
	/** Fractions of the comp range, default 0 / .25 / .5 / .75 / 1. */
	sampleFractions?: readonly number[]
	compId?: string
	bodyContrast?: number
	largeContrast?: number
	largeTextPx?: number
	titleSafeMargin?: number
	overlapRatio?: number
	maxFindings?: number
}

interface Rgba {
	r: number
	g: number
	b: number
	a: number
}

const HEX = /^#([0-9a-f]{3,8})$/i
const RGB = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i
const NAMED: Record<string, string> = {
	black: '#000000',
	white: '#ffffff',
	red: '#ff0000',
	green: '#008000',
	blue: '#0000ff',
	grey: '#808080',
	gray: '#808080',
	transparent: '#00000000',
}

/** Parse the colour forms the mock schema accepts; null when unparseable. */
export function parseColor(raw: unknown): Rgba | null {
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		const value = Math.max(0, Math.round(raw)) >>> 0
		return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff, a: 1 }
	}
	if (typeof raw !== 'string') return null
	const text = raw.trim().toLowerCase()
	const named = NAMED[text]
	if (named) return parseColor(named)
	const hex = HEX.exec(text)
	if (hex) {
		const digits = hex[1]
		if (digits.length === 3 || digits.length === 4) {
			const [r, g, b, a] = digits.split('')
			return {
				r: Number.parseInt(r + r, 16),
				g: Number.parseInt(g + g, 16),
				b: Number.parseInt(b + b, 16),
				a: a === undefined ? 1 : Number.parseInt(a + a, 16) / 255,
			}
		}
		if (digits.length === 6 || digits.length === 8) {
			return {
				r: Number.parseInt(digits.slice(0, 2), 16),
				g: Number.parseInt(digits.slice(2, 4), 16),
				b: Number.parseInt(digits.slice(4, 6), 16),
				a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
			}
		}
		return null
	}
	const rgb = RGB.exec(text)
	if (rgb) {
		const channel = (part: string): number => (part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part))
		const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4])
		return { r: channel(rgb[1]), g: channel(rgb[2]), b: channel(rgb[3]), a: alpha }
	}
	return null
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: Rgba): number {
	const channel = (value: number): number => {
		const c = Math.max(0, Math.min(255, value)) / 255
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
	}
	return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
	const a = relativeLuminance(foreground)
	const b = relativeLuminance(background)
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function isVisible(scene: MockScene, layer: MockLayer, frame: number): boolean {
	if (scene.getAttr(layer, 'hidden') === true) return false
	if (frame < layer.inFrame || frame > layer.outFrame) return false
	let opacity = 1
	let current: MockLayer | null = layer
	let guard = 0
	while (current && guard < 32) {
		if (scene.getAttr(current, 'hidden') === true) return false
		opacity *= Number(scene.getAttr(current, 'opacity')) || 0
		current = current.parentId ? scene.layer(current.parentId) : null
		guard += 1
	}
	return opacity >= MIN_READABLE_OPACITY
}

function textColor(scene: MockScene, layer: MockLayer): Rgba | null {
	const candidates = [
		scene.getAttr(layer, 'material.materialColor'),
		scene.getAttr(layer, 'materialColor'),
		scene.getAttr(layer, 'color'),
	]
	for (const candidate of candidates) {
		const parsed = parseColor(candidate)
		if (parsed) return parsed
	}
	return null
}

interface Box {
	left: number
	right: number
	top: number
	bottom: number
	width: number
	height: number
}

function boxOf(scene: MockScene, id: string): Box | null {
	const box = scene.boundingBox(id)
	if (!box) return null
	return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
}

function containsPoint(box: Box, x: number, y: number): boolean {
	return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/**
 * The solid colour behind a text layer: the topmost visible, non-text visual
 * layer below it in z-order whose AABB contains the text centre, else the
 * comp background. This is the graph equivalent of the upstream "hide the
 * text and average the pixels inside its box".
 */
function backgroundColor(scene: MockScene, compId: string, layer: MockLayer, frame: number, textBox: Box): Rgba | null {
	const comp = scene.comps.get(compId)
	if (!comp) return null
	const textIndex = comp.layerIds.indexOf(layer.id)
	const cx = (textBox.left + textBox.right) / 2
	const cy = (textBox.top + textBox.bottom) / 2
	for (let i = textIndex - 1; i >= 0; i -= 1) {
		const candidate = scene.layer(comp.layerIds[i])
		if (!candidate || candidate.type === 'textShape') continue
		if (!isVisible(scene, candidate, frame)) continue
		const box = boxOf(scene, candidate.id)
		if (!box || !containsPoint(box, cx, cy)) continue
		const fill = parseColor(scene.getAttr(candidate, 'material.materialColor'))
		if (fill && fill.a >= 0.5) return fill
	}
	return parseColor(comp.bgColor)
}

function round2(value: number): number {
	return Math.round(value * 100) / 100
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000
}

function sampleFramesFor(scene: MockScene, compId: string, options: SceneLintOptions): number[] {
	const comp = scene.comps.get(compId)
	if (!comp) return []
	if (Array.isArray(options.frames) && options.frames.length) {
		return [...new Set(options.frames.map((frame) => Math.round(Number(frame))).filter((frame) => Number.isFinite(frame)))]
			.filter((frame) => frame >= comp.startFrame && frame <= comp.endFrame)
			.sort((a, b) => a - b)
	}
	const fractions = options.sampleFractions?.length ? options.sampleFractions : SCENE_LINT_SAMPLE_FRACTIONS
	const span = comp.endFrame - comp.startFrame
	return [...new Set(fractions.map((fraction) => Math.round(comp.startFrame + span * Math.max(0, Math.min(1, fraction)))))].sort((a, b) => a - b)
}

/**
 * Lint the current scene graph across sampled frames without moving the
 * caller's playhead. Returns every contrast, overlap and title-safe violation
 * with the frames where it occurs.
 */
export function lintSceneGraph(scene: MockScene, options: SceneLintOptions = {}): SceneLintReport {
	const comp = options.compId ? scene.comps.get(options.compId) ?? null : scene.activeComp()
	const counts: Record<SceneLintRule, number> = { contrast: 0, overlap: 0, 'title-safe': 0 }
	if (!comp) {
		return {
			passed: true,
			compId: null,
			frames: [],
			checked: { frames: 0, textLayers: 0 },
			findings: [],
			counts,
		}
	}
	const bodyContrast = options.bodyContrast ?? SCENE_LINT_BODY_CONTRAST
	const largeContrast = options.largeContrast ?? SCENE_LINT_LARGE_CONTRAST
	const largeTextPx = options.largeTextPx ?? SCENE_LINT_LARGE_TEXT_PX
	const margin = options.titleSafeMargin ?? SCENE_LINT_TITLE_SAFE_MARGIN
	const overlapRatio = options.overlapRatio ?? SCENE_LINT_OVERLAP_RATIO
	const maxFindings = options.maxFindings ?? 64
	const frames = sampleFramesFor(scene, comp.id, options)
	// Scene coordinates are comp-centred (x/y 0 is the middle), so the
	// title-safe box is symmetric around zero.
	const halfWidth = comp.width / 2
	const halfHeight = comp.height / 2
	const safe = {
		left: -halfWidth + comp.width * margin,
		right: halfWidth - comp.width * margin,
		top: -halfHeight + comp.height * margin,
		bottom: halfHeight - comp.height * margin,
	}

	const found = new Map<string, SceneLintFinding>()
	const record = (rule: SceneLintRule, layers: string[], frame: number, detail: string): void => {
		const key = `${rule}|${layers.join('|')}`
		const existing = found.get(key)
		if (existing) {
			if (!existing.frames.includes(frame)) existing.frames.push(frame)
			return
		}
		if (found.size >= maxFindings) return
		found.set(key, { rule, level: 'error', layers, frames: [frame], detail })
	}

	const previous = scene.frame
	let textLayerCount = 0
	try {
		for (const frame of frames) {
			scene.frame = frame
			const visibleText: Array<{ layer: MockLayer; box: Box; text: string; size: number; color: Rgba }> = []
			for (const id of comp.layerIds) {
				const layer = scene.layer(id)
				if (!layer || layer.type !== 'textShape') continue
				if (!isVisible(scene, layer, frame)) continue
				const text = String(scene.getAttr(layer, 'text') ?? '').trim()
				if (text.length < MIN_TEXT_LENGTH) continue
				const box = boxOf(scene, id)
				if (!box || box.width < 1 || box.height < 1) continue
				const color = textColor(scene, layer)
				if (!color || color.a < 0.5) continue
				const size = Math.abs(Number(scene.getAttr(layer, 'fontSize')) || 24)
				visibleText.push({ layer, box, text, size, color })
			}
			textLayerCount = Math.max(textLayerCount, visibleText.length)

			for (const item of visibleText) {
				const bg = backgroundColor(scene, comp.id, item.layer, frame, item.box)
				if (!bg) continue
				const required = item.size >= largeTextPx ? largeContrast : bodyContrast
				const ratio = contrastRatio(item.color, bg)
				if (ratio + 1e-9 < required) {
					record(
						'contrast',
						[item.layer.id],
						frame,
						`"${item.text.slice(0, 24)}" (${item.layer.name}) is ${round2(ratio)}:1; needs ${required}:1 at ${Math.round(item.size)}px`,
					)
				}
				if (item.box.left < safe.left || item.box.right > safe.right || item.box.top < safe.top || item.box.bottom > safe.bottom) {
					record(
						'title-safe',
						[item.layer.id],
						frame,
						`"${item.text.slice(0, 24)}" (${item.layer.name}) escapes the 90% title-safe box [${round2(safe.left)}, ${round2(safe.top)}, ${round2(safe.right)}, ${round2(safe.bottom)}]`,
					)
				}
			}

			for (let i = 0; i < visibleText.length; i += 1) {
				for (let j = i + 1; j < visibleText.length; j += 1) {
					const a = visibleText[i]
					const b = visibleText[j]
					const ix = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left)
					const iy = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top)
					if (ix <= 0 || iy <= 0) continue
					const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height)
					if (smaller <= 0) continue
					const ratio = (ix * iy) / smaller
					if (ratio > overlapRatio) {
						record(
							'overlap',
							[a.layer.id, b.layer.id],
							frame,
							`"${a.text.slice(0, 16)}" × "${b.text.slice(0, 16)}" overlap ${Math.round(ratio * 100)}% of the smaller text box`,
						)
					}
				}
			}
		}
	} finally {
		scene.frame = previous
	}

	const findings = [...found.values()]
		.map((finding) => ({ ...finding, frames: [...finding.frames].sort((a, b) => a - b) }))
		.sort((a, b) => {
			const order: SceneLintRule[] = ['contrast', 'overlap', 'title-safe']
			const byRule = order.indexOf(a.rule) - order.indexOf(b.rule)
			if (byRule !== 0) return byRule
			return a.layers.join('|').localeCompare(b.layers.join('|'))
		})
	for (const finding of findings) counts[finding.rule] += 1

	return {
		passed: findings.length === 0,
		compId: comp.id,
		frames,
		checked: { frames: frames.length, textLayers: textLayerCount },
		findings,
		counts,
	}
}

/** Convenience: sample exactly one frame. */
export function lintSceneGraphAtFrame(scene: MockScene, frame: number, options: SceneLintOptions = {}): SceneLintReport {
	return lintSceneGraph(scene, { ...options, frames: [frame] })
}

/** Human-readable one-line summary per finding, for CLI output. */
export function formatSceneLintReport(report: SceneLintReport): string[] {
	if (report.passed) {
		return [`PASS scene-lint: ${report.checked.textLayers} text layers over ${report.checked.frames} frames — contrast, overlap and title-safe`]
	}
	const lines = [
		`FAIL scene-lint: ${report.findings.length} findings (${report.counts.contrast} contrast, ${report.counts.overlap} overlap, ${report.counts['title-safe']} title-safe) over ${report.checked.frames} frames`,
	]
	for (const finding of report.findings) {
		lines.push(`  [${finding.rule}] ${finding.detail} @ ${finding.frames.join(', ')}`)
	}
	return lines
}
