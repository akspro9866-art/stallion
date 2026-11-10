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
	'generator.radius': point(50, 50),
	'generator.cornerRadius': num(0),
	'generator.tlRadius': num(0),
	'generator.trRadius': num(0),
	'generator.brRadius': num(0),
	'generator.blRadius': num(0),
	'generator.chamfer': num(0),
	'generator.divisions': num(0),
	'generator.radiusTop': num(0),
	'generator.radiusBottom': num(0),
	'generator.vectorize': bool(false),
	'generator.expression': str(),
	radius: point(50, 50),
	material: any,
	'material.materialColor': color('#ffffff'),
	'material.alpha': num(1),
	'material.colorShaders': any,
	'material.shader': any,
	'stroke.strokeColor': color('#ffffff'),
	'stroke.width': num(1),
	strokeColor: color('#ffffff'),
	strokeWidth: num(1),
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
	// `_mg.text` colours copy through the material, exactly like shapes.
	material: any,
	'material.materialColor': color('#ffffff'),
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
		attributes: {
			...BASE,
			falloffType: str('linear'),
			influence: num(1),
			radius: num(100),
			size: point(100, 100),
			strength: num(100),
			shapeType: num(0),
			position: point(0, 0),
		},
	},
	stagger: { visual: false, attributes: { ...BASE, delayFrames: num(4), staggerType: str('temporal'), offset: num(4) } },
	noise: {
		visual: false,
		attributes: {
			...BASE,
			frequency: num(1),
			timeScale: num(1),
			seed: num(0),
			amplitude: num(1),
			strength: num(10),
			'generator.frequency': num(1),
			'generator.seed': num(0),
			falloffs: any,
		},
	},
	oscillator: { visual: false, attributes: { ...BASE, frequency: num(1), amplitude: num(1), phase: num(0), waveType: str('sine') } },
	subMesh: {
		visual: false,
		attributes: {
			...BASE,
			subMeshLevel: num(0),
			levelMode: num(0),
			timeOffset: num(0),
			falloffs: any,
		},
	},
	travel: { visual: false, attributes: { ...BASE, travel: num(0), start: num(0), end: num(100) } },
	bevel: { visual: false, attributes: { ...BASE, bevelRadius: num(4), cornerRadius: num(4) } },
	boolean: { visual: false, attributes: { ...BASE, booleanMode: str('union') } },
	pathfinder: { visual: false, attributes: { ...BASE, pathfinderMode: str('union') } },
	blurFilter: { visual: false, attributes: { ...BASE, blurRadius: num(4) } },
	gaussianBlurFilter: { visual: false, attributes: { ...BASE, blurRadius: num(4) } },
	dropShadowFilter: {
		visual: false,
		attributes: { ...BASE, shadowRadius: num(4), shadowOffsetX: num(0), shadowOffsetY: num(4), shadowColor: color('#000000'), shadowOpacity: num(0.5) },
	},
	innerShadowFilter: { visual: false, attributes: { ...BASE, shadowRadius: num(4) } },
	grainFilter: { visual: false, attributes: { ...BASE, grainAmount: num(0.2) } },
	backgroundBlurFilter: { visual: false, attributes: { ...BASE, blurRadius: num(4) } },
	connectShape: { visual: false, attributes: { ...BASE, targetMode: any, maxConnections: num(10), curve: bool(false) } },
	meshDistribution: { visual: false, attributes: { ...BASE, distribution: str('linear') } },
	null: { visual: false, attributes: { ...BASE } },
	camera: { visual: false, attributes: { ...BASE } },
	javaScriptShape: { visual: true, attributes: { ...BASE, ...SHAPE_GENERATOR, expression: str(), 'generator.expression': str() } },
	javaScriptUtility: { visual: false, attributes: { ...BASE, expression: str(), output: num(0) } },
	javaScriptModifier: { visual: false, attributes: { ...BASE, expression: str(), output: num(0) } },
	javaScriptDeformer: { visual: false, attributes: { ...BASE, expression: str(), falloffs: any } },
	javaScriptEmitter: { visual: false, attributes: { ...BASE, expression: str() } },
	skslShader: { visual: false, attributes: { ...BASE, code: str(), shaderCode: str(), uniforms: any } },
	skslFilter: { visual: false, attributes: { ...BASE, code: str(), shaderCode: str(), uniforms: any } },
	renderQueueItem: {
		visual: false,
		attributes: {
			...BASE,
			selected: bool(true),
			preRenderExpression: str(),
			postRenderExpression: str(),
			renderSetupExpression: str(),
		},
	},
	linearGradient: {
		visual: false,
		attributes: { ...BASE, stops: any, angle: num(0), start: point(-100, 0), end: point(100, 0), generator: any },
	},
	value: { visual: false, attributes: { ...BASE, value: num(0) } },
	value2: { visual: false, attributes: { ...BASE, value: point(0, 0) } },
	valueBlend: { visual: false, attributes: { ...BASE, a: any, b: any, weight: num(50) } },
	transformConstraint: { visual: false, attributes: { ...BASE, weight: num(100), target: any } },
	align: { visual: false, attributes: { ...BASE, x: num(0), y: num(0), alignX: num(0), alignY: num(0) } },
	spring: { visual: false, attributes: { ...BASE, stiffness: num(200), damping: num(20), mass: num(1) } },
	stringGenerator: {
		visual: false,
		attributes: {
			...BASE,
			number: num(0),
			precision: num(0),
			prefix: str(),
			suffix: str(),
			'generator.number': num(0),
			'generator.precision': num(0),
			'generator.prefix': str(),
			'generator.suffix': str(),
		},
	},
}

const GENERIC: NodeDef = { visual: false, attributes: {} }

export function nodeDef(type: string): NodeDef {
	return NODE_TYPES[type] ?? GENERIC
}

/**
 * True when `path` names a known attribute (exact match, or a component of a
 * known compound like `position.x` under `position`, or a known compound
 * under a bare parent like `generator.dimensions` under `generator`, or a
 * registered dynamic/uniform attribute namespace).
 */
export function isKnownAttribute(type: string, path: string): boolean {
	if (path.startsWith('array.') || path.startsWith('dynamic.') || path.startsWith('uniforms.')) return true
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

/** Attribute paths every valid layer accepts — used for connect() checks. */
export function isConnectableAttribute(type: string, attr: string): boolean {
	return (
		isKnownAttribute(type, attr) ||
		attr === 'id' ||
		attr === 'deformers' ||
		attr === 'generator' ||
		attr === 'masks' ||
		attr === 'filters' ||
		attr === 'falloffs' ||
		attr === 'material.shader' ||
		attr === 'material.colorShaders' ||
		attr === 'transform'
	)
}
