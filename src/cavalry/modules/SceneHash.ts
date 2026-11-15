/**
 * Live-side fast scene-tree checksum (kind: 'scene_hash').
 *
 * This file is a string runner because it executes inside code Stallion hands
 * to `api.exec` — Cavalry's scripting host: no Node APIs, no crypto module.
 * The digest mirrors the mock bridge's `scene-hash.ts`: a dual-lane FNV-1a
 * over `comp(<id>)`, `layers(<id1>,<id2>,...)` in hierarchy order and one
 * `link(<dst>.<attr><-<src>=<value>)` entry per incoming connection — the full
 * scene graph never crosses HTTP, only the 16-hex digest does.
 */

export const SCENE_HASH_TYPE = 'scene_hash'

export const SCENE_HASH_SCRIPT = `
var __sceneHashValue = (function () {
	var read = function (fn) { try { return fn(); } catch (e) { return null; } };
	function digest(input) {
		var hi = 0x811c9dc5, lo = 0x1b873593;
		for (var i = 0; i < input.length; i++) {
			var ch = input.charCodeAt(i);
			hi = Math.imul((hi ^ (ch & 0xff)) >>> 0, 0x01000193) >>> 0;
			lo = Math.imul((lo ^ ((ch >>> 8) & 0xff)) >>> 0, 0x01000193) >>> 0;
		}
		function hex(n) { var out = ''; for (var s = 28; s >= 0; s -= 4) out += ((n >>> s) & 0xf).toString(16); return out; }
		return hex(hi) + hex(lo);
	}
	function stableValue(value) {
		if (value === null || value === undefined) return 'null';
		var kind = typeof value;
		if (kind === 'number') return isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : String(value);
		if (kind === 'string') return JSON.stringify(value);
		if (kind === 'boolean') return value ? 'true' : 'false';
		if (Array.isArray(value)) {
			var items = [];
			for (var i = 0; i < value.length; i++) items.push(stableValue(value[i]));
			return '[' + items.join(',') + ']';
		}
		if (kind === 'object') {
			var names = [];
			for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) names.push(key);
			names.sort();
			var entries = [];
			for (var e = 0; e < names.length; e++) entries.push(JSON.stringify(names[e]) + ':' + stableValue(value[names[e]]));
			return '{' + entries.join(',') + '}';
		}
		return String(value);
	}
	var parts = [];
	var compId = read(function () { return api.getActiveComp(); });
	parts.push('comp(' + (compId == null ? '' : String(compId)) + ')');
	var layerIds = read(function () { return api.getCompLayers(false); });
	if (!Array.isArray(layerIds)) layerIds = [];
	parts.push('layers(' + layerIds.join(',') + ')');
	var connectionCount = 0;
	for (var i = 0; i < layerIds.length && i < 400; i++) {
		var layerId = String(layerIds[i]);
		var incoming = read(function () { return api.getInConnectedAttributes(layerId); });
		if (!Array.isArray(incoming)) continue;
		for (var j = 0; j < incoming.length; j++) {
			var attr = String(incoming[j]);
			var source = read(function () { return api.getInConnection(layerId, attr); });
			var sourceText = Array.isArray(source) ? source.join('+') : String(source == null ? '' : source);
			var value = read(function () { return api.get(layerId, attr); });
			parts.push('link(' + layerId + '.' + attr + '<-' + sourceText + '=' + stableValue(value) + ')');
			connectionCount++;
		}
	}
	return { hash: digest(parts.join(';')), algorithm: 'fnv1a-32x2', compId: compId == null ? '' : String(compId), layerCount: layerIds.length, connectionCount: connectionCount };
})();
__result = __sceneHashValue;
`
