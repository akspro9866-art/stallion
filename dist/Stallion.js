// VERSION 0.10.0
// This is the compiled version
// Read the source at https://github.com/akspro9866-art/stallion.git
(()=>{var A=`
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
			out.push({ level: trimmed[i].level, text: text.length > MAX_CONSOLE_TEXT ? text.slice(0, MAX_CONSOLE_TEXT) + '\u2026' : text });
		}
		return out;
	}
	return { read: read, facts: facts, hash: hash, beatBoxes: beatBoxes, consoleLines: consoleLines };
})();
`.trim();var k="0.10.0",F="io.scenery.stallion",b="__stallion_result__",S="__stallionResult__",R="render-frames";function a(h){try{return h()}catch{return null}}var p=class{#t;#r;constructor(e,t){this.#t=e,this.#r=t}static loadConfig(){let e={host:"127.0.0.1",port:8080,token:""},t=a(()=>api.getAppDataFolder());if(!t||typeof t!="string")return e;let n=t.replace(/[\\/]$/,"")+"/stallion.json";if(a(()=>api.filePathExists(n))!==!0)return e;let r=a(()=>JSON.parse(api.readFromFile(n)));return!r||typeof r!="object"?e:{host:typeof r.host=="string"&&r.host?r.host:e.host,port:typeof r.port=="number"&&Number.isFinite(r.port)&&r.port>0&&r.port<65536?Math.floor(r.port):e.port,token:typeof r.token=="string"?r.token:e.token}}#e=e=>{a(()=>{this.#t.setResultForGet(typeof e=="string"?e:JSON.stringify(e))})};serveStatus=()=>{this.#e({kind:"status",stallion:k,cavalry:a(()=>api.getCavalryVersion()),scene:a(()=>api.getSceneFilePath()),frame:a(()=>api.getFrame()),unSaved:a(()=>api.sceneHasUnsavedChanges()),capabilities:{receipt:!0,renderFrames:!0,mock:!1},ts:Date.now()})};#i=e=>{let t=a(()=>globalThis[S]);if(typeof t!="string")return;let n=a(()=>JSON.parse(t));n&&n.seq===e&&this.#e(t)};onPost=()=>{this.#n(a(()=>this.#t.getNextPost()));let e=64;for(;e-- >0;){let t=a(()=>this.#t.postCount());if(typeof t!="number"||!Number.isFinite(t)||t<1)break;this.#n(a(()=>this.#t.getNextPost()))}};#n=e=>{if(!e||typeof e.result!="string"){console.error("Stallion: No post data");return}let t=a(()=>JSON.parse(e.result));if(!t||typeof t!="object"){console.error("Stallion: Failed to parse request as JSON");return}if(console.log("Stallion: Data received"),t.type===b){this.#e(e.result);return}if(t.type===R){this.#s(t);return}let{type:n,code:r,path:o,seq:s,statePath:f}=t;if(!n&&!o){console.error("Stallion: Missing/empty `type` key in request");return}if(!r&&!o){console.error("Stallion: Missing/empty `code` or `path` key in request");return}if(n==="script"||o){if(r&&o&&console.warn("Stallion: `code` and `path` keys are both in the request, executing `path`"),o){if(!api.filePathExists(o)){this.#e({kind:"result",seq:s,ok:!1,error:`No script found at ${o}`}),console.error(`Stallion: No script found at ${o}`);return}if(ui.runFileScript(o)){this.#e({kind:"result",seq:s,ok:!0,note:"file script executed (no captured result)"}),console.log("Stallion: Script successfully executed");return}this.#e({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(r){let _=api.exec(F,this.#a(r,s,f,{beatFrames:t.beatFrames,diagnostics:t.diagnostics===!0}));if(this.#i(s),_){console.log("Stallion: Script successfully executed");return}this.#e({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}this.#e({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(typeof n=="string"&&(n.startsWith("javaScript")||n.startsWith("sksl"))){let _=api.getSelection();_.length||(_=[api.create(n)]);let l="expression";n==="javaScriptShape"&&(l="generator.expression"),n.startsWith("sksl")&&(l="code");let u=[],i=[];for(let c of _){if(api.getLayerType(c)!==n){let g=api.getNiceName(c);i.push(String(g)),console.warn(`Stallion: Skipped layer '${g}' because it is not of type '${n}'`);continue}api.set(c,{[l]:r}),u.push(String(c))}this.#e({kind:"result",seq:s,ok:!0,applied:u,skipped:i}),console.log("Stallion: Successfully applied expression");return}if(typeof n=="string"&&n.toLowerCase().includes("render")){let _=api.getRenderQueueItems(),l=[];for(let u of _)api.get(u,"selected")&&(api.set(u,{[n]:r}),l.push(String(u)));this.#e({kind:"result",seq:s,ok:!0,applied:l}),console.log("Stallion: Successfully applied render expression");return}this.#e({kind:"result",seq:s,ok:!1,error:`Unexpected type '${n}'`}),console.error(`Stallion: Unexpected type '${n}'`)};#a=(e,t,n,r)=>{let o=`http://${this.#r.host}:${this.#r.port}`,s=this.#r.token,f=JSON.stringify(t)??"undefined",_=JSON.stringify(n??""),l=e.startsWith("/* cavalry-mcp:atomic */"),u=l?e:`(() => {
	var __undo = typeof api.startUndoGroup === 'function';
	if (__undo) api.startUndoGroup('AI Motion Batch');
	try {
		return (() => { ${e}
})();
	} finally {
		if (__undo) api.endUndoGroup();
	}
})()`,i=l?"":`var __telemetry = (function () {
	var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
	var __top = function () { var ids = __read(function () { return api.getCompLayers(true); }); return Array.isArray(ids) ? ids : []; };
	var __before = __top();
	var __started = Date.now();
	var __snapshot = {
		seq: ${f}, status: 'ok', errorStack: null, createdLayerIds: [],
		activeSelection: [], compInfo: null, boundingBoxes: {}, modifiedLayerIds: []
	};
	var __compInfo = function () {
		var id = __read(function () { return api.getActiveComp(); });
		if (!id) return null;
		var fps = __read(function () { return api.get(id, 'fps'); });
		var resolution = __read(function () { return api.get(id, 'resolution'); });
		var startFrame = __read(function () { return api.get(id, 'startFrame'); });
		var endFrame = __read(function () { return api.get(id, 'endFrame'); });
		if (startFrame == null) startFrame = __read(function () { return api.getInFrame(id); });
		if (endFrame == null) endFrame = __read(function () { return api.getOutFrame(id); });
		var res = null;
		if (Array.isArray(resolution)) res = [Number(resolution[0]) || 0, Number(resolution[1]) || 0];
		else if (resolution && typeof resolution === 'object') res = [Number(resolution.x) || 0, Number(resolution.y) || 0];
		return {
			id: String(id), name: __read(function () { return api.getNiceName(id); }),
			fps: fps == null ? null : Number(fps),
			startFrame: startFrame == null ? null : Number(startFrame),
			endFrame: endFrame == null ? null : Number(endFrame),
			resolution: res, width: res ? res[0] : null, height: res ? res[1] : null
		};
	};
	var __finalize = function () {
		try {
			var after = __top();
			var seen = {};
			for (var i = 0; i < __before.length; i++) seen[__before[i]] = true;
			for (var j = 0; j < after.length; j++) if (!seen[after[j]]) __snapshot.createdLayerIds.push(after[j]);
			__snapshot.activeSelection = __read(function () { return api.getSelection(); }) || [];
			__snapshot.compInfo = __compInfo();
			var ids = __snapshot.createdLayerIds.concat(__snapshot.activeSelection.filter(function (id) { return after.indexOf(id) >= 0; }));
			var boxed = {};
			for (var k = 0; k < ids.length && k < 50; k++) {
				var id = ids[k];
				if (boxed[id]) continue;
				boxed[id] = true;
				var bb = __read(function () { return api.getBoundingBox(id, true); });
				if (bb && typeof bb === 'object') {
					var box = { x: Number(bb.x) || 0, y: Number(bb.y) || 0, width: Number(bb.width) || 0, height: Number(bb.height) || 0 };
					if (bb.centre) box.centre = { x: Number(bb.centre.x) || 0, y: Number(bb.centre.y) || 0 };
					__snapshot.boundingBoxes[id] = box;
				}
			}
			__snapshot.durationMs = Date.now() - __started;
			__snapshot.writtenAt = new Date().toISOString();
			try {
				var folder = api.getFolderFromPath(__statePath);
				if (folder && typeof api.makeFolder === 'function') __read(function () { return api.makeFolder(folder); });
			} catch (e) {}
			try {
				api.writeToFile(__statePath, JSON.stringify(__snapshot), true);
			} catch (writeErr) {
				try { api.writeToFile(__statePath, JSON.stringify({ seq: ${f}, status: __snapshot.status, errorStack: __snapshot.errorStack, writeFailed: String(writeErr) }), true); } catch (e) {}
			}
			try { globalThis.__stallionState = __snapshot; } catch (e) {}
		} catch (e) {}
	};
	return { snapshot: __snapshot, finalize: __finalize };
})()`,c=l?`try {
	var __shared = globalThis.__stallionState;
	if (__shared && __shared.seq === ${f}) __state = __shared;
} catch (e) {}`:`if (__telemetry && __telemetry.finalize) {
	__telemetry.finalize();
	__state = __telemetry.snapshot;
}`,x=Array.isArray(r?.beatFrames)?r.beatFrames.map(v=>Math.round(Number(v))).filter(v=>Number.isFinite(v)).slice(0,32):[],g=r?.diagnostics===!0?`(function () {
	if (typeof api === 'undefined' || !__stallionReceipt) return;
	var origSet = api.set;
	if (typeof origSet === 'function') {
		try {
			api.set = function (id, attrs) {
				var names = attrs && typeof attrs === 'object' ? Object.keys(attrs) : [];
				for (var i = 0; i < names.length; i++) {
					(function (attr) {
						var def = __stallionReceipt.read(function () { return api.getAttributeDefinition(id, attr); });
						if (def === null || def === undefined) {
							var value = __stallionReceipt.read(function () { return api.get(id, attr); });
							if (value === null || value === undefined) __diag.invalidAttrs.push(String(id) + '.' + String(attr));
						}
					})(names[i]);
				}
				return origSet.apply(api, arguments);
			};
		} catch (e) { __consoleLog.push({ level: 'warn', text: 'Stallion: api.set probe unavailable' }); }
	}
	var origConnect = api.connect;
	if (typeof origConnect === 'function') {
		try {
			api.connect = function (srcId, srcAttr, dstId, dstAttr) {
				var srcOk = __stallionReceipt.read(function () { return api.getLayerType(srcId); });
				var dstOk = __stallionReceipt.read(function () { return api.getLayerType(dstId); });
				var result = origConnect.apply(api, arguments);
				if (srcOk === null || srcOk === undefined || dstOk === null || dstOk === undefined) {
					__diag.failedConnections.push(String(srcId) + '->' + String(dstId));
					return result;
				}
				var link = __stallionReceipt.read(function () { return api.getInConnection(dstId, dstAttr); });
				var dead = link === null || link === undefined || (Array.isArray(link) && link.length === 0);
				if (dead) __diag.failedConnections.push(String(srcId) + ':' + String(srcAttr) + '->' + String(dstId) + ':' + String(dstAttr));
				return result;
			};
		} catch (e) { __consoleLog.push({ level: 'warn', text: 'Stallion: api.connect probe unavailable' }); }
	}
})();`:"";return`(function () {
var __deliver = function (payload) {
	try { globalThis.${S} = payload; } catch (e) {}
	try {
		var __client = new api.WebClient(${JSON.stringify(o)});
		${s?`__client.setTokenAuthentication(${JSON.stringify(s)});`:""}
		__client.post('/post', payload, 'application/json');
	} catch (e) {}
};
var __statePath = ${_};
if (!__statePath) {
	try { __statePath = api.getHomeFolder() + '/.cavalry-mcp/last-execution-state.json'; } catch (e) {}
}
${A}
var __state = null;
${i}
if (typeof __telemetry !== 'undefined' && __telemetry && __telemetry.snapshot) __state = __telemetry.snapshot;
var __consoleLog = [];
var __consoleRestore = (function () {
	var entries = __consoleLog;
	var saved = {};
	if (typeof console === 'undefined') return function () {};
	var levels = ['log', 'info', 'warn', 'error'];
	for (var i = 0; i < levels.length; i++) {
		(function (level) {
			var original = typeof console[level] === 'function' ? console[level] : null;
			saved[level] = original;
			try {
				console[level] = function () {
					var parts = [];
					for (var a = 0; a < arguments.length; a++) {
						parts.push(typeof arguments[a] === 'string' ? arguments[a] : (function () { try { return JSON.stringify(arguments[a]); } catch (e) { return String(arguments[a]); } })());
					}
					entries.push({ level: level, text: parts.join(' ') });
					if (original) { try { original.apply(console, arguments); } catch (e) {} }
				};
			} catch (e) { entries.push({ level: 'warn', text: 'Stallion: console.' + level + ' could not be captured' }); }
		})(levels[i]);
	}
	return function () {
		for (var key in saved) { try { console[key] = saved[key]; } catch (e) {} }
	};
})();
var __diag = { invalidAttrs: [], failedConnections: [] };
${g}
var __out = { type: ${JSON.stringify(b)}, kind: 'result', seq: ${f}, ok: true };
try {
	var __result;
	var __returned = ${u};
	if (typeof __result === 'undefined') __result = __returned;
	if (typeof __result !== 'undefined') __out.result = __result;
} catch (err) {
	__out.ok = false;
	__out.error = err.toString();
	__out.stack = err.stack;
	if (__state) { __state.status = 'error'; __state.errorStack = String(err.stack || err); }
} finally {
	try { __consoleRestore(); } catch (e) {}
}
${c}
if (__state) {
	if (__out.ok === false && __state.status !== 'error') { __state.status = 'error'; __state.errorStack = __out.stack || __out.error || null; }
	__out.state = __state;
}
try {
	var __receiptIds = [];
	if (__state && Array.isArray(__state.createdLayerIds)) __receiptIds = __receiptIds.concat(__state.createdLayerIds);
	if (__state && Array.isArray(__state.activeSelection)) __receiptIds = __receiptIds.concat(__state.activeSelection);
	var __beatFrames = ${JSON.stringify(x)};
	__out.receipt = {
		sceneStateHash: __stallionReceipt.hash(__stallionReceipt.facts()),
		consoleDiagnostics: __stallionReceipt.consoleLines(__consoleLog),
		beatBBoxes: __stallionReceipt.beatBoxes(__receiptIds, __beatFrames)
	};
	if (__diag.invalidAttrs.length || __diag.failedConnections.length) __out.receipt.apiDiagnostics = __diag;
	if (__state) __state.receipt = __out.receipt;
} catch (e) {
	__out.receipt = { sceneStateHash: null, consoleDiagnostics: [], beatBBoxes: {}, receiptError: String(e) };
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(b)}, kind: 'result', seq: ${f}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`};#o=(e,t)=>{let n=a(()=>globalThis[S]);if(typeof n!="string")return;let r=a(()=>JSON.parse(n));!r||r.seq!==e||this.#e(JSON.stringify(t(r)))};#s=e=>{let t=e.seq,r=(Array.isArray(e.frames)?e.frames:[]).map(i=>Math.round(Number(i))).filter(i=>Number.isFinite(i)&&Math.abs(i)<1e9);if(!r.length){this.#e({kind:"render-frames",seq:t,ok:!1,error:"render-frames requires a non-empty frames array"});return}if(r.length>2e3){this.#e({kind:"render-frames",seq:t,ok:!1,error:"render-frames accepts at most 2000 frames per batch"});return}let o=Number(e.resolutionScale),s=Number.isFinite(o)&&o>0?Math.min(4,Math.max(.01,o)):.5,f=e.format==="raw_rgba"?"raw_rgba":"png_buffer",_=typeof e.compId=="string"&&e.compId.trim()?e.compId.trim():"",l=typeof e.outDir=="string"&&e.outDir.trim()?e.outDir.trim():"",u=api.exec(F,C({frames:r,scale:s,format:f,compId:_,outDir:l,seq:t}));if(this.#o(t,i=>{let c=typeof i.result=="object"&&i.result!==null?i.result:{};return{...c,type:i.type,seq:i.seq,kind:"render-frames",ok:i.ok===!0&&c.ok!==!1}}),!u){this.#e({kind:"render-frames",seq:t,ok:!1,error:"Script failed to execute"}),console.error("Stallion: render-frames script failed to execute");return}console.log("Stallion: render-frames batch executed")}};function C(h){return`var __rf = ${JSON.stringify(h)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __rf.compId || __prevComp;
if (__rf.compId) api.setActiveComp(__rf.compId);
var __prevFrame = __read(function () { return api.getFrame(); });
var __res = __read(function () { return api.get(__compId, 'resolution'); });
var __width = null, __height = null;
if (Array.isArray(__res)) { __width = Number(__res[0]) || null; __height = Number(__res[1]) || null; }
else if (__res && typeof __res === 'object') { __width = Number(__res.x) || null; __height = Number(__res.y) || null; }
var __dir = __rf.outDir;
if (!__dir) {
	var __seqText = String(__rf.seq == null ? 'batch' : __rf.seq).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
	__dir = api.getHomeFolder() + '/.stallion/frames/' + (__seqText || 'batch');
}
var __folder = __read(function () { return api.getFolderFromPath(__dir); });
if (__folder && typeof api.makeFolder === 'function') __read(function () { return api.makeFolder(__folder); });
var __rendered = [];
var __failed = [];
var __scalePct = Math.max(1, Math.min(400, Math.round(__rf.scale * 100)));
try {
	for (var __i = 0; __i < __rf.frames.length; __i++) {
		var __frame = __rf.frames[__i];
		try {
			api.setFrame(__frame);
			var __padded = String(Math.abs(__frame));
			while (__padded.length < 6) __padded = '0' + __padded;
			var __base = __dir + '/frame-' + (__frame < 0 ? '-' : '') + __padded;
			api.renderPNGFrame(__base, __scalePct);
			var __file = __base + '.png';
			var __bytes = __read(function () { return api.getFileSize(__file); });
			__rendered.push({ frame: __frame, file: __file, bytes: __bytes == null ? null : Number(__bytes) });
		} catch (__err) {
			__failed.push({ frame: __frame, error: String(__err && __err.message ? __err.message : __err) });
		}
	}
} finally {
	if (__prevFrame != null) __read(function () { return api.setFrame(__prevFrame); });
	if (__rf.compId && __prevComp) __read(function () { return api.setActiveComp(__prevComp); });
}
var __inlineNote = null;
if (__rf.format === 'raw_rgba') {
	__inlineNote = 'raw_rgba pixel readback is unavailable through this bridge; the rendered PNG files are listed per frame \u2014 read them over localhost, or use a mock bridge for inline buffers.';
}
__result = {
	ok: __rendered.length > 0,
	kind: 'render-frames',
	format: __rf.format,
	scale: __rf.scale,
	scalePercent: __scalePct,
	compId: __compId == null ? null : String(__compId),
	width: __width,
	height: __height,
	outDir: __dir,
	rendered: __rendered,
	failed: __failed,
	inlineNote: __inlineNote
};`}var N="2.4.0",O=cavalry.versionLessThan(N);if(O)throw new Error(`Stallion requires Cavalry ${N} or higher`);var d=p.loadConfig(),m=new api.WebServer,w=new p(m,d);m.listen(d.host,d.port);m.addCallbackObject(w);m.setHighFrequency();d.token&&(m.setTokenAuthentication(d.token),console.warn("Stallion: token authentication enabled via stallion.json"));w.serveStatus();var I={CENTRE:1},E=new ui.Label(`v${k} \u2014 listening on ${d.host}:${d.port}`);E.setAlignment(I.CENTRE);var T=new ui.Label("[Documentation](https://github.com/akspro9866-art/stallion#readme)");T.setAlignment(I.CENTRE);var y=new ui.VLayout;y.addStretch();y.add(E,T);y.addStretch();ui.setTitle("Stallion");ui.add(y);ui.show();})();
