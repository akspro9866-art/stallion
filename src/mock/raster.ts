/**
 * Deterministic software rasterizer + minimal PNG encoder for the mock
 * bridge. It renders the mock scene graph into RGBA buffers so
 * render-frames / perceptual pipelines have real pixels to diff during CI,
 * with zero native dependencies. Deliberately simple: axis-aligned bounds
 * per shape, no anti-aliasing, nearest-neighbour transform sampling — the
 * goal is reproducible verification frames, not visual fidelity.
 *
 * Colour parse: #rgb / #rrggbb / #rrggbbaa. Blend modes: normal,
 * multiply, screen, add. Everything else falls back to source-over.
 */

import zlib from 'node:zlib'
import { MockScene, type MockLayer } from './scene.ts'

export interface RasterizedFrame {
	width: number
	height: number
	rgba: Buffer
}

function parseColor(value: unknown): [number, number, number, number] {
	// _rb.set normalises colors to {r, g, b, a} objects; raw scripts pass hex.
	if (value && typeof value === 'object') {
		const v = value as Record<string, unknown>
		return [Number(v.r) || 0, Number(v.g) || 0, Number(v.b) || 0, v.a == null ? 255 : Number(v.a) || 255]
	}
	if (typeof value !== 'string') return [255, 255, 255, 255]
	const hex = value.replace('#', '')
	if (hex.length === 3) {
		return [
			parseInt(hex[0] + hex[0], 16),
			parseInt(hex[1] + hex[1], 16),
			parseInt(hex[2] + hex[2], 16),
			255,
		]
	}
	if (hex.length >= 6) {
		return [
			parseInt(hex.slice(0, 2), 16) || 0,
			parseInt(hex.slice(2, 4), 16) || 0,
			parseInt(hex.slice(4, 6), 16) || 0,
			hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) || 255 : 255,
		]
	}
	return [255, 255, 255, 255]
}

function blendChannel(mode: string, base: number, top: number): number {
	switch (mode) {
		case 'multiply':
			return (base * top) / 255
		case 'screen':
			return 255 - ((255 - base) * (255 - top)) / 255
		case 'add':
		case 'linearDodge':
			return Math.min(255, base + top)
		default:
			return top
	}
}

interface ShapeGeometry {
	kind: 'rect' | 'ellipse'
	w: number
	h: number
	cx: number
	cy: number
	rotation: number
	scaleX: number
	scaleY: number
	pivotX: number
	pivotY: number
}

function shapeGeometry(scene: MockScene, layer: MockLayer): ShapeGeometry | null {
	const kindRaw = String(layer.attrs.get('generator') ?? 'rectangleShape')
	const kind = kindRaw.includes('ellipse') ? 'ellipse' : 'rect'
	const dimsRaw = scene.getAttr(layer, 'generator.dimensions')
	const dims = Array.isArray(dimsRaw) ? dimsRaw : [100, 100]
	const t = scene.worldTransform(layer.id)
	const pivotRaw = scene.getAttr(layer, 'pivot')
	const pivot = Array.isArray(pivotRaw) ? pivotRaw : [0, 0]
	const posRaw = scene.getAttr(layer, 'position')
	const pos = Array.isArray(posRaw) ? posRaw : [0, 0]
	return {
		kind,
		w: Math.max(1, Number(dims[0]) || 100),
		h: Math.max(1, Number(dims[1]) || 100),
		cx: Number(pos[0]) || 0,
		cy: Number(pos[1]) || 0,
		rotation: t.rotation,
		scaleX: t.scaleX,
		scaleY: t.scaleY,
		pivotX: Number(pivot[0]) || 0,
		pivotY: Number(pivot[1]) || 0,
	}
}

function textGeometry(scene: MockScene, layer: MockLayer): ShapeGeometry {
	const text = String(scene.getAttr(layer, 'text') ?? '')
	const fontSize = Number(scene.getAttr(layer, 'fontSize')) || 24
	const boxRaw = scene.getAttr(layer, 'textBoxSize')
	const box = Array.isArray(boxRaw) && Number(boxRaw[0]) > 0 ? boxRaw : [text.length * fontSize * 0.55, fontSize * 1.2]
	const t = scene.worldTransform(layer.id)
	const pivotRaw = scene.getAttr(layer, 'pivot')
	const pivot = Array.isArray(pivotRaw) ? pivotRaw : [0, 0]
	const posRaw = scene.getAttr(layer, 'position')
	const pos = Array.isArray(posRaw) ? posRaw : [0, 0]
	return {
		kind: 'rect',
		w: Math.max(1, Number(box[0])),
		h: Math.max(1, Number(box[1])),
		cx: Number(pos[0]) || 0,
		cy: Number(pos[1]) || 0,
		rotation: t.rotation,
		scaleX: t.scaleX,
		scaleY: t.scaleY,
		pivotX: Number(pivot[0]) || 0,
		pivotY: Number(pivot[1]) || 0,
	}
}

/** Render one frame of the mock scene into an RGBA buffer. */
export function rasterizeFrame(scene: MockScene, compId: string, frame: number, width: number, height: number): RasterizedFrame {
	const comp = scene.comps.get(compId)
	const w = Math.max(1, Math.round(width))
	const h = Math.max(1, Math.round(height))
	const rgba = Buffer.alloc(w * h * 4)
	const bg = parseColor(comp?.bgColor ?? '#000000')
	for (let i = 0; i < w * h; i++) {
		rgba[i * 4] = bg[0]
		rgba[i * 4 + 1] = bg[1]
		rgba[i * 4 + 2] = bg[2]
		rgba[i * 4 + 3] = 255
	}
	if (!comp) return { width: w, height: h, rgba }

	// Output pixels may be a downscaled view of the comp: comp units are
	// converted to pixel units with a single factor derived from the widths.
	const scale = w / comp.width
	const invScale = 1 / scale

	for (const layerId of comp.layerIds) {
		const layer = scene.layers.get(layerId)
		if (!layer) continue
		const defHidden = scene.getAttr(layer, 'hidden')
		if (defHidden === true) continue
		const isText = layer.type === 'textShape'
		const isShape = layer.type === 'basicShape' || layer.type === 'editableShape' || layer.type === 'rectangleShape' || layer.type === 'ellipseShape'
		if (!isText && !isShape) continue
		const geo = isText ? textGeometry(scene, layer) : shapeGeometry(scene, layer)
		if (!geo) continue
		const color = parseColor(scene.getAttr(layer, 'material.materialColor'))
		const matAlpha = Number(scene.getAttr(layer, 'material.alpha'))
		const opacity = Number(scene.getAttr(layer, 'opacity'))
		const alpha = Math.max(0, Math.min(1, (Number.isFinite(matAlpha) ? matAlpha : 1) * (Number.isFinite(opacity) ? opacity : 1)))
		if (alpha <= 0) continue
		const mode = String(scene.getAttr(layer, 'blendMode') ?? 'normal')

		// Local-space half extents after scale; pivot offsets the shape centre.
		const hw = (geo.w / 2) * geo.scaleX
		const hh = (geo.h / 2) * geo.scaleY
		const rad = (-geo.rotation * Math.PI) / 180
		const cos = Math.cos(rad)
		const sin = Math.sin(rad)
		const originX = geo.cx - (geo.pivotX * geo.scaleX * Math.cos((geo.rotation * Math.PI) / 180) - geo.pivotY * geo.scaleY * Math.sin((geo.rotation * Math.PI) / 180))
		const originY = geo.cy - (geo.pivotX * geo.scaleX * Math.sin((geo.rotation * Math.PI) / 180) + geo.pivotY * geo.scaleY * Math.cos((geo.rotation * Math.PI) / 180))
		// Output-space bounding box of the rotated shape, in pixel units.
		const extX = Math.abs(hw * cos) + Math.abs(hh * sin)
		const extY = Math.abs(hw * sin) + Math.abs(hh * cos)
		const minX = Math.max(0, Math.floor((originX - extX) * scale + w / 2))
		const maxX = Math.min(w - 1, Math.ceil((originX + extX) * scale + w / 2))
		const minY = Math.max(0, Math.floor(h / 2 - (originY + extY) * scale))
		const maxY = Math.min(h - 1, Math.ceil(h / 2 - (originY - extY) * scale))

		for (let py = minY; py <= maxY; py++) {
			for (let px = minX; px <= maxX; px++) {
				// comp-space coords (origin centre, y up)
				const x = (px + 0.5 - w / 2) * invScale
				const y = (h / 2 - (py + 0.5)) * invScale
				const dx = x - originX
				const dy = y - originY
				const lx = dx * cos - dy * sin
				const ly = dx * sin + dy * cos
				let inside: boolean
				if (geo.kind === 'ellipse') {
					const nx = lx / Math.max(hw, 1e-6)
					const ny = ly / Math.max(hh, 1e-6)
					inside = nx * nx + ny * ny <= 1
				} else {
					inside = Math.abs(lx) <= hw && Math.abs(ly) <= hh
				}
				if (!inside) continue
				const index = (py * w + px) * 4
				const a = alpha * 255
				const prevA = rgba[index + 3]
				const outA = a + (prevA / 255) * (255 - a)
				if (outA === 0) continue
				for (let c = 0; c < 3; c++) {
					const base = rgba[index + c]
					const top = mode === 'normal' ? color[c] : blendChannel(mode, base, color[c])
					rgba[index + c] = Math.round((top * a + base * (prevA / 255) * (255 - a)) / (outA || 1))
				}
				rgba[index + 3] = Math.round(outA)
			}
		}
	}
	return { width: w, height: h, rgba }
}

// ------------------------------------------------------------------- png

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

function crc32(buf: Buffer): number {
	let c = 0xffffffff
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)
	const typeBuf = Buffer.from(type, 'ascii')
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
	return Buffer.concat([length, typeBuf, data, crc])
}

/** Encode RGBA pixels as a true PNG (8-bit RGBA, filter 0, zlib deflate). */
export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // colour type RGBA
	const stride = width * 4
	const raw = Buffer.alloc((stride + 1) * height)
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0 // filter: none
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
	}
	const idat = zlib.deflateSync(raw, { level: 6 })
	return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
