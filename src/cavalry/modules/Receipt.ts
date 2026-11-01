/**
 * Deterministic post-execution receipt — runtime source.
 *
 * Every script execution reports a structured receipt next to the atomic undo
 * transaction it belongs to:
 *
 *   - sceneStateHash      fast deterministic hash of active node IDs,
 *                         attribute connections and keyframe counts
 *   - consoleDiagnostics  warnings and errors raised while the script ran
 *                         (plus invalid attribute paths / silent connect()
 *                         failures observed by the optional probes)
 *   - beatBBoxes          world-space bounding boxes of the mutated layers,
 *                         evaluated at the caller's requested beat frames
 *
 * This file is a string because the receipt runs inside code that Stallion
 * hands to `api.exec` — Cavalry's scripting host, no Node APIs, no crypto
 * module. The digest is a dual-lane FNV-1a over a canonical scene string:
 * deterministic, not cryptographic — identical scenes always hash identically
 * and any change to nodes, connections or keyframe counts changes the hash.
 *
 * The runtime defines (idempotently) on a `__stallionReceipt` namespace:
 *   .read(fn)          — safe read, null on throw
 *   .facts()           — {layers:[{id,type,keyframes}], connections:[]}
 *   .hash(facts)       — sceneStateHash string
 *   .beatBoxes(ids, frames) — {frame: boxes per layer id}
 *   .console(entries)  — trimmed console entry list
 */

export const RECEIPT_RUNTIME = `
var __stallionReceipt = (function () {
	var MAX_CONSOLE_ENTRIES = 64;
	var MAX_CONSOLE_TEXT = 240;
	var MAX_BEAT_FRAMES = 32;
	var MAX_BEAT_LAYERS = 50;
	var MAX_DIGEST_LAYERS = 400;
	var read = function (fn) { try { return fn(); } catch (e) { return null; } };
	var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; };
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
	function facts() {
		var layers = [], connections = [];
		var ids = read(function () { return api.getCompLayers(false); });
		if (!Array.isArray(ids)) return { layers: layers, connections: connections };
		ids = ids.slice(0, MAX_DIGEST_LAYERS);
		for (var i = 0; i < ids.length; i++) {
			var id = String(ids[i]);
			var type = String(read(function () { return api.getLayerType(id); }) ?? '?');
			var keyframes = 0;
			var animated = read(function () { return api.getAnimatedAttributes(id); });
			if (Array.isArray(animated)) {
				for (var j = 0; j < animated.length; j++) {
					var attr = animated[j];
					var times = read(function () { return api.getKeyframeTimes(id, attr); });
					if (Array.isArray(times)) keyframes += times.length;
				}
			}
			layers.push({ id: id, type: type, keyframes: keyframes });
			var incoming = read(function () { return api.getInConnectedAttributes(id); });
			if (Array.isArray(incoming)) {
				for (var k = 0; k < incoming.length; k++) connections.push(id + '<-' + String(incoming[k]));
			}
		}
		layers.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
		connections.sort();
		return { layers: layers, connections: connections };
	}
	function hash(f) {
		var parts = [];
		for (var i = 0; i < f.layers.length; i++) parts.push(f.layers[i].id + ':' + f.layers[i].type + '@k=' + f.layers[i].keyframes);
		return digest('nodes(' + parts.join(';') + ')conn(' + f.connections.join(';') + ')');
	}
	function beatBoxes(ids, frames) {
		var out = {};
		var list = Array.isArray(frames) ? frames.slice(0, MAX_BEAT_FRAMES) : [];
		var layerIds = Array.isArray(ids) ? ids.filter(function (id, index, all) { return all.indexOf(id) === index; }).slice(0, MAX_BEAT_LAYERS) : [];
		var prevFrame = read(function () { return api.getFrame(); });
		try {
			for (var f = 0; f < list.length; f++) {
				var frame = Number(list[f]);
				if (!isFinite(frame)) continue;
				if (read(function () { return api.setFrame(frame); }) === null && typeof api.setFrame === 'function') continue;
				var boxes = {};
				for (var l = 0; l < layerIds.length; l++) {
					var layerId = layerIds[l];
					var bb = read(function () { return api.getBoundingBox(layerId, true); });
					if (!bb || typeof bb !== 'object') continue;
					var pivot = read(function () { return api.getPivotPosition(layerId); });
					var rotation = read(function () { return api.get(layerId, 'rotation'); });
					var box = {
						x: num(bb.x), y: num(bb.y),
						width: num(bb.width), height: num(bb.height),
						pivotX: 0, pivotY: 0, rotation: num(rotation)
					};
					if (pivot && typeof pivot === 'object') { box.pivotX = num(pivot.x); box.pivotY = num(pivot.y); }
					else if (Array.isArray(pivot)) { box.pivotX = num(pivot[0]); box.pivotY = num(pivot[1]); }
					boxes[layerId] = box;
				}
				out[String(frame)] = boxes;
			}
		} finally {
			if (prevFrame != null && typeof api.setFrame === 'function') read(function () { return api.setFrame(prevFrame); });
		}
		return out;
	}
	function consoleLines(entries) {
		var trimmed = Array.isArray(entries) ? entries.slice(0, MAX_CONSOLE_ENTRIES) : [];
		var out = [];
		for (var i = 0; i < trimmed.length; i++) {
			var text = String(trimmed[i].text == null ? '' : trimmed[i].text);
			out.push({ level: trimmed[i].level, text: text.length > MAX_CONSOLE_TEXT ? text.slice(0, MAX_CONSOLE_TEXT) + '…' : text });
		}
		return out;
	}
	return { read: read, facts: facts, hash: hash, beatBoxes: beatBoxes, consoleLines: consoleLines };
})();
`.trim()
