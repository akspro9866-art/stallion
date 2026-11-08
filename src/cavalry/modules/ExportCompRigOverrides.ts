/**
 * `/export_comp_rig_overrides` — pull manual rig tweaks back out of a live comp.
 *
 * ## Why this exists
 *
 * A cloned style (`cavalry-mcp` `presets/cloned/*.json`) hydrates into a
 * procedural Cavalry comp. Artists then nudge the things a preset cannot
 * express well: spring stiffness, oscillator range, sub-mesh stagger, palette,
 * font sizes. This readback exports exactly those knobs so
 * `sync_active_comp_to_cloned_style` can fold the tweaks back into the preset
 * instead of asking the artist to retype them.
 *
 * ## Scope discipline
 *
 * Geometry and keyframes belong to Stages 3–5; this endpoint is deliberately
 * narrow. It reads every *declared* attribute whose path looks procedural or
 * visual (bounded by `RIG_OVERRIDES_MAX_ATTRS` per layer) plus any explicit
 * `attributes` the caller names. The playhead is never moved — unlike
 * `batch_inspect`, a single-state read needs no scrubbing — and the active
 * comp is restored if the caller targets a different one.
 *
 * Envelope:
 *
 *   {
 *     ok: true,
 *     kind: 'export_comp_rig_overrides',
 *     seq, compId, frame,
 *     compFrameRate, compResolution, compEndFrame,
 *     layers: [{ id, name, type, parent, hidden, attrs: {…}, animated: [...] }],
 *     layerCount, elapsedMs
 *   }
 *
 * The comp-level facts exist for the reverse sync: a manual `fontSize` tweak
 * is absolute pixels, so folding it into a preset needs the width it was
 * applied at; frame-like knobs need the duration to re-normalize to ratios.
 *
 * `attrs` carries only attributes the host actually resolved; an absent path
 * means "not a real attribute on this node", not "value is falsy". Values are
 * returned as the host reports them — hex strings stay strings, physics stays
 * numbers — so the sync step can write them back without guessing types.
 */

export const EXPORT_COMP_RIG_OVERRIDES_TYPE = 'export_comp_rig_overrides'

export const RIG_OVERRIDES_MAX_LAYERS = 200
export const RIG_OVERRIDES_MAX_ATTRS = 64
export const RIG_OVERRIDES_MAX_EXPLICIT = 32
export const RIG_OVERRIDES_MAX_ANIMATED = 16

/**
 * Substring match against declared attribute paths. Deliberately broad on the
 * procedural side (every pack names its knobs slightly differently) and
 * narrow on the visual side (only the palette/font attrs a style preset
 * actually tokens).
 */
const RIG_ATTR_PATTERN_SOURCE = [
	'stiffness',
	'damping',
	'mass',
	'tension',
	'friction',
	'frequency',
	'amplitude',
	'phase',
	'wobble',
	'speed',
	'rate',
	'stagger',
	'lagFrames',
	'delayFrames',
	'offsetFrames',
	'holdFrames',
	'count',
	'rows',
	'columns',
	'spacing',
	'gutter',
	'color',
	'colour',
	'fontSize',
	'tracking',
	'leading',
	'seed',
	'min',
	'max',
	'offset',
].join('|')

export interface ExportRigOverridesJob {
	seq: unknown
	compId: string
	layerIds: string[]
	attributes: string[]
}

export interface ExportRigOverridesError {
	code: import('./Introspect.ts').ErrorCode
	error: string
}

/**
 * Normalize a caller-supplied request. An empty `layerIds` means "every layer
 * in the comp" (capped); an empty `attributes` means "pattern match only".
 */
export function normalizeExportRigOverridesJob(
	parsed: Record<string, unknown>,
): { job: ExportRigOverridesJob } | { error: ExportRigOverridesError } {
	const layerIds = Array.isArray(parsed.layerIds)
		? (parsed.layerIds as unknown[])
				.map((id) => (typeof id === 'string' ? id.trim() : ''))
				.filter(Boolean)
				.slice(0, RIG_OVERRIDES_MAX_LAYERS)
		: []
	const attributes = Array.isArray(parsed.attributes)
		? (parsed.attributes as unknown[])
				.map((attr) => (typeof attr === 'string' ? attr.trim() : ''))
				.filter(Boolean)
				.slice(0, RIG_OVERRIDES_MAX_EXPLICIT)
		: []
	return {
		job: {
			seq: parsed.seq,
			compId: typeof parsed.compId === 'string' ? parsed.compId.trim() : '',
			layerIds,
			attributes,
		},
	}
}

/**
 * The readback runtime, as source for `api.exec`. Atomic (a read must not open
 * an undo step) and defensive per attribute: one odd node cannot abort the
 * export. The source ends in `})()` with no semicolon — the wrapped expression
 * value is how the result travels back (see Introspect.ts).
 */
export function exportCompRigOverridesScript(job: ExportRigOverridesJob): string {
	return `/* cavalry-mcp:atomic */ (function () {
var __ro = ${JSON.stringify(job)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __hex2 = function (n) { var s = Math.max(0, Math.min(255, Math.round(__num(n, 0)))).toString(16); return s.length < 2 ? '0' + s : s; };
var __color = function (v) {
	return v && typeof v === 'object' && typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number'
		? '#' + __hex2(v.r) + __hex2(v.g) + __hex2(v.b)
		: null;
};
var __rigRe = new RegExp(${JSON.stringify(`(?:${RIG_ATTR_PATTERN_SOURCE})`)}, 'i');
var __started = Date.now();
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __ro.compId || __prevComp;
if (!__compId) {
	return { ok: false, kind: 'export_comp_rig_overrides', seq: __ro.seq, error: 'No active comp to export from.', code: 'STALLION_NO_ACTIVE_COMP' };
}
if (__ro.compId && __ro.compId !== __prevComp) { __read(function () { return api.setActiveComp(__ro.compId); }); }
var __frame = __num(__read(function () { return api.getFrame(); }), 0);
// Comp metadata mirrors BatchInspect's fallbacks so both readbacks agree with
// the host even when it spells the fields differently.
var __compFrameRate = null;
var __fr = __read(function () { return api.get(__compId, 'frameRate'); });
if (__fr === null || __fr === undefined) __fr = __read(function () { return api.get(__compId, 'fps'); });
if (typeof __fr === 'number' && isFinite(__fr) && __fr > 0) __compFrameRate = __fr;
var __compResolution = null;
var __res = __read(function () { return api.get(__compId, 'resolution'); });
var __compW = null, __compH = null;
if (Array.isArray(__res) && __res.length >= 2) { __compW = Number(__res[0]); __compH = Number(__res[1]); }
else if (__res && typeof __res === 'object') { __compW = Number(__res.x); __compH = Number(__res.y); }
if (!(__compW > 0 && __compH > 0)) {
	__compW = __read(function () { return api.get(__compId, 'width'); });
	__compH = __read(function () { return api.get(__compId, 'height'); });
}
if (typeof __compW === 'number' && __compW > 0 && typeof __compH === 'number' && __compH > 0) {
	__compResolution = [__compW, __compH];
}
var __compEndFrame = __read(function () { return api.get(__compId, 'endFrame'); });
if (typeof __compEndFrame !== 'number' || !isFinite(__compEndFrame)) {
	__compEndFrame = __read(function () { return api.getOutFrame(__compId); });
}
if (typeof __compEndFrame !== 'number' || !isFinite(__compEndFrame)) __compEndFrame = null;
var __ids = __ro.layerIds.length
	? __ro.layerIds.slice(0, ${RIG_OVERRIDES_MAX_LAYERS})
	: (__read(function () { return api.getCompLayers(false); }) || []).slice(0, ${RIG_OVERRIDES_MAX_LAYERS});
var __layers = [];
for (var i = 0; i < __ids.length; i++) {
	var __id = __ids[i];
	var __type = String(__read(function () { return api.getLayerType(__id); }) || '');
	if (!__type) continue;
	var __declared = __read(function () { return api.getAttributes(__id); }) || [];
	var __wanted = [];
	for (var d = 0; d < __declared.length && __wanted.length < ${RIG_OVERRIDES_MAX_ATTRS}; d++) {
		var __path = String(__declared[d]);
		// Host bookkeeping knobs that merely look procedural; never preset inputs.
		if (/posterize/i.test(__path)) continue;
		if (__ro.attributes.indexOf(__path) !== -1 || __rigRe.test(__path)) __wanted.push(__path);
	}
	var __attrs = {};
	for (var w = 0; w < __wanted.length; w++) {
		var __val = __read(function () { return api.get(__id, __wanted[w]); });
		if (__val === null || __val === undefined) continue;
		if (Array.isArray(__val)) __attrs[__wanted[w]] = __val.map(function (item) { return typeof item === 'number' ? item : String(item); });
		else if (__color(__val)) __attrs[__wanted[w]] = __color(__val);
		else if (typeof __val === 'object') __attrs[__wanted[w]] = { x: __num(__val.x, 0), y: __num(__val.y, 0) };
		else if (typeof __val === 'number' || typeof __val === 'boolean' || typeof __val === 'string') __attrs[__wanted[w]] = __val;
		else __attrs[__wanted[w]] = String(__val);
	}
	var __animated = (__read(function () { return api.getAnimatedAttributes(__id); }) || []).slice(0, ${RIG_OVERRIDES_MAX_ANIMATED});
	var __hidden = __read(function () { return api.get(__id, 'hidden'); });
	__layers.push({
		id: __id,
		name: String(__read(function () { return api.getNiceName(__id); }) || __id),
		type: __type,
		parent: __read(function () { return api.getParent(__id); }) || null,
		hidden: __hidden === true || __hidden === 1 || __hidden === 'true',
		attrs: __attrs,
		animated: __animated
	});
}
// Restore only the comp; the playhead was never moved by this readback.
if (__ro.compId && __prevComp && __ro.compId !== __prevComp) { __read(function () { return api.setActiveComp(__prevComp); }); }
return {
	ok: true,
	kind: 'export_comp_rig_overrides',
	seq: __ro.seq,
	compId: String(__compId),
	frame: __frame,
	compFrameRate: __compFrameRate,
	compResolution: __compResolution,
	compEndFrame: __compEndFrame,
	layers: __layers,
	layerCount: __layers.length,
	elapsedMs: Date.now() - __started
};
})()`
}
