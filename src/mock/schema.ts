/**
 * Cavalry 2.8 node/attribute schema for the mock bridge.
 *
 * Incoming api calls are validated against this table so CI exercises the
 * same discipline a live bridge would: unknown node types and unknown
 * attribute paths become recorded diagnostics instead of silently mutating
 * an imaginary scene. The attribute names come from the live 2.8 surface
 * (cavalry-mcp probe attribute samples) plus every path the `_mg` runtime
 * and rig builders actually write.
 */

export interface AttrDef {
	/** number | point ([x, y]) | color (#rrggbb) | string | bool | any */
	kind: 'number' | 'point' | 'color' | 'string' | 'bool' | 'any'
	default?: unknown
}

export interface NodeDef {
	visual: boolean
	attributes: Record<string, AttrDef>
}

const num = (d: number): AttrDef => ({ kind: 'number', default: d })
const point = (x: number, y: number): AttrDef => ({ kind: 'point', default: [x, y] })
const color = (d: string): AttrDef => ({ kind: 'color', default: d })
const str = (d = ''): AttrDef => ({ kind: 'string', default: d })
const bool = (d = false): AttrDef => ({ kind: 'bool', default: d })
const any: AttrDef = { kind: 'any' }

/** Attributes shared by every layer, from the live 2.8 attribute samples. */
const BASE: Record<string, AttrDef> = {
	is3d: bool(false),
	blendMode: str('normal'),
	masks: any,
	clippingMode: any,
	deformers: any,
	drawOnTopOfParent: bool(false),
	excludeFromLayout: bool(false),
	featherAmount: num(0),
	featherMasks: any,
	filters: any,
	posterizeFrameRate: num(0),
	frozen: bool(false),
	guideLayer: bool(false),
	hidden: bool(false),
	layoutFrame: num(0),
	forceLottieBake: bool(false),
	webExport: bool(false),
	motionBlur: bool(false),
	multiStroke: bool(false),
	posterizeTimeOffset: num(0),
	opacity: num(1),
	pivot: point(0, 0),
	position: point(0, 0),
	posterizeTime: num(0),
	rotation: num(0),
	scale: point(100, 100),
	skew: num(0),
	stroke: any,
	matteMode: any,
	trackMattes: any,
	name: str(),
	id: str(),
}

const SHAPE_GENERATOR: Record<string, AttrDef> = {
	generator: any,
	'generator.dimensions': point(100, 100),
	'generator.cornerRadius': num(0),
	'generator.chamfer': num(0),
	'generator.divisions': num(0),
	'generator.radiusTop': num(0),
	'generator.radiusBottom': num(0),
	'generator.vectorize': bool(false),
	material: any,
	'material.materialColor': color('#ffffff'),
	'material.alpha': num(1),
	'material.colorShaders': any,
}

const TEXT_ATTRS: Record<string, AttrDef> = {
	text: str(),
	font: str('Inter'),
	fontSize: num(24),
	letterSpacing: num(0),
	wordSpacing: num(0),
	lineSpacing: num(1.2),
	paragraphSpacing: num(0),
	textBoxSize: point(0, 0),
	horizontalAlignment: str('left'),
	autoName: bool(true),
	style: any,
	pathTravel: num(0),
	pathPush: num(0),
	pathLoop: bool(false),
}

/** Node types the mock models. Everything else validates as a generic node. */
export const NODE_TYPES: Record<string, NodeDef> = {
	compNode: {
		visual: false,
		attributes: {
			resolution: point(1920, 1080),
			'resolution.x': num(1920),
			'resolution.y': num(1080),
			fps: num(24),
			backgroundColor: color('#000000'),
			startFrame: num(0),
			endFrame: num(215),
		},
	},
	basicShape: { visual: true, attributes: { ...BASE, ...SHAPE_GENERATOR } },
	ellipseShape: { visual: true, attributes: { ...BASE, ...SHAPE_GENERATOR } },
	rectangleShape: { visual: true, attributes: { ...BASE, ...SHAPE_GENERATOR } },
	polygonShape: { visual: true, attributes: { ...BASE, ...SHAPE_GENERATOR } },
	starShape: { visual: true, attributes: { ...BASE, ...SHAPE_GENERATOR } },
	editableShape: { visual: true, attributes: { ...BASE, inputPath: str(), fillRule: any, ...SHAPE_GENERATOR } },
	textShape: { visual: true, attributes: { ...BASE, ...TEXT_ATTRS } },
	group: { visual: true, attributes: { ...BASE, groupMode: any } },
	image: { visual: true, attributes: { ...BASE, assetPath: str() } },
	preComp: { visual: true, attributes: { ...BASE } },
	duplicator: {
		visual: false,
		attributes: {
			distribution: str('linear'),
			count: num(2),
			size: point(100, 100),
			staggerOffset: num(0),
			generator: any,
		},
	},
	falloff: {
		visual: false,
		attributes: { falloffType: str('linear'), influence: num(1), radius: num(100), position: point(0, 0) },
	},
	stagger: { visual: false, attributes: { delayFrames: num(4), staggerType: str('temporal') } },
	noise: { visual: false, attributes: { frequency: num(1), timeScale: num(1), seed: num(0), amplitude: num(1) } },
	oscillator: { visual: false, attributes: { frequency: num(1), amplitude: num(1), phase: num(0), waveType: str('sine') } },
	subMesh: { visual: false, attributes: { subMeshLevel: num(0) } },
	travel: { visual: false, attributes: { travel: num(0), start: num(0), end: num(100) } },
	bevel: { visual: false, attributes: { bevelRadius: num(4), cornerRadius: num(4) } },
	boolean: { visual: false, attributes: { booleanMode: str('union') } },
	pathfinder: { visual: false, attributes: { pathfinderMode: str('union') } },
	blurFilter: { visual: false, attributes: { blurRadius: num(4) } },
	gaussianBlurFilter: { visual: false, attributes: { blurRadius: num(4) } },
	dropShadowFilter: {
		visual: false,
		attributes: { shadowRadius: num(4), shadowOffsetX: num(0), shadowOffsetY: num(4), shadowColor: color('#000000'), shadowOpacity: num(0.5) },
	},
	innerShadowFilter: { visual: false, attributes: { shadowRadius: num(4) } },
	grainFilter: { visual: false, attributes: { grainAmount: num(0.2) } },
	backgroundBlurFilter: { visual: false, attributes: { blurRadius: num(4) } },
	connectShape: { visual: false, attributes: { targetMode: any, maxConnections: num(10), curve: bool(false) } },
	meshDistribution: { visual: false, attributes: { distribution: str('linear') } },
	null: { visual: false, attributes: {} },
	camera: { visual: false, attributes: {} },
}

const GENERIC: NodeDef = { visual: false, attributes: {} }

export function nodeDef(type: string): NodeDef {
	return NODE_TYPES[type] ?? GENERIC
}

/**
 * True when `path` names a known attribute (exact match, or a component of a
 * known compound like `position.x` under `position`, or a known compound
 * under a bare parent like `generator.dimensions` under `generator`).
 */
export function isKnownAttribute(type: string, path: string): boolean {
	const def = nodeDef(type)
	if (path in def.attributes) return true
	const dot = path.lastIndexOf('.')
	if (dot > 0) {
		const parent = path.slice(0, dot)
		if (parent in def.attributes) return true
		// generator.dimensions.x → generator.dimensions is a point on basicShape
		if (isKnownAttribute(type, parent)) return true
	}
	return false
}

export function attributeDefault(type: string, path: string): unknown {
	return nodeDef(type).attributes[path]?.default
}

/** Attribute paths every valid layer accepts — used for connect() checks. */
export function isConnectableAttribute(type: string, attr: string): boolean {
	return isKnownAttribute(type, attr) || attr === 'deformers' || attr === 'generator' || attr === 'masks'
}
