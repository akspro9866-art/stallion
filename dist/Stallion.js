// VERSION 0.10.0
// This is the compiled version
// Read the source at https://github.com/akspro9866-art/stallion.git
(()=>{var C=`
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
`.trim();var w="state",R="layers",h="snapshot";var $=["position.x","position.y","scale.x","scale.y","rotation","opacity"],y={BAD_REQUEST:"STALLION_BAD_REQUEST",MISSING_SEQ:"STALLION_MISSING_SEQ",EXEC_FAILED:"STALLION_EXEC_FAILED",NO_COMP:"STALLION_NO_ACTIVE_COMP",NO_FRAME:"STALLION_NO_FRAME",BAD_LAYER:"STALLION_UNKNOWN_LAYER",RENDER_FAILED:"STALLION_RENDER_FAILED",UNAUTHORISED:"STALLION_UNAUTHORISED"};function S(a,e,t,r={}){let n={ok:!1,kind:a,error:t,code:e};return r.seq!==void 0&&(n.seq=r.seq),r.mgCall&&(n.mgCall=r.mgCall),r.layerId&&(n.layerId=r.layerId),r.attrPath&&(n.attrPath=r.attrPath),r.stack&&(n.stack=String(r.stack).slice(0,2e3)),n}function m(a,e,t,r){let n=Number(a);return Number.isFinite(n)?Math.min(r,Math.max(t,Math.round(n))):e}function T(a,e){let r=(Array.isArray(e.attrs)?e.attrs:[]).map(n=>typeof n=="string"?n.trim():"").filter(Boolean).slice(0,40);return{kind:a,seq:e.seq,compId:typeof e.compId=="string"?e.compId.trim():"",frame:Number.isFinite(Number(e.frame))?m(e.frame,0,-1e9,1e9):null,restoreFrame:null,offset:m(e.offset,0,0,1e9),limit:m(e.limit,200,1,1e3),attrs:r.length?r:[...$],includeAttributes:e.attributes===!0,budgetMs:m(e.budgetMs,120,5,5e3)}}function O(a){let e=Number(a.frame??a.t);if(!Number.isFinite(e))return{error:"snapshot requires a numeric `frame` (or `t`).",code:y.NO_FRAME};let t=Number(a.scale??a.resolutionScale),r=typeof a.fileName=="string"&&a.fileName.trim()?a.fileName.trim().replace(/[\\/:*?"<>|]/g,"_").slice(0,80):`snapshot-${String(Math.round(e)).padStart(6,"0")}`;return{job:{seq:a.seq,compId:typeof a.compId=="string"?a.compId.trim():"",frame:m(e,0,-1e9,1e9),restoreFrame:null,scale:Number.isFinite(t)&&t>0?m(t,100,1,400):100,outDir:typeof a.outDir=="string"?a.outDir.trim().replace(/\\/g,"/"):"",fileName:r}}}function L(a){return`/* cavalry-mcp:atomic */ (function () {
var __rb = ${JSON.stringify(a)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
// getBoundingBox(id, true) is documented as {x, y, width, height, centre, left, right,
// top}. Reading width/height rather than w/h is what the shipped receipt code already
// does against a live 2.8 host; the array and w/h fallbacks stay so one odd layer type
// cannot blank out a box.
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
var __started = Date.now();
var __prevComp = __read(function () { return api.getActiveComp(); });
var __compId = __rb.compId || __prevComp;
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__rb.compId && __rb.compId !== __prevComp) { __read(function () { api.setActiveComp(__rb.compId); }); }
// An empty scene and a scene with no comp open are different states, and collapsing
// them into total:0 forces the caller to guess. Say which one it is.
if (!__compId) {
	return { ok: false, kind: __rb.kind, seq: __rb.seq, error: 'No active comp to read back.', code: 'STALLION_NO_ACTIVE_COMP' };
}

var __slug = function (text) {
	return String(text == null ? '' : text)
		.replace(/[^A-Za-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase()
		.slice(0, 48);
};

var __ids = __read(function () { return api.getCompLayers(false); }) || [];
var __top = __read(function () { return api.getCompLayers(true); }) || [];
var __topSet = {};
for (var t = 0; t < __top.length; t++) __topSet[__top[t]] = true;

// Depth from the comp root, so a hierarchy can be rebuilt without a second pass.
var __depth = {};
var depthOf = function (id) {
	if (__depth[id] !== undefined) return __depth[id];
	var guard = 0, d = 0, cur = id;
	while (guard++ < 32) {
		var p = __read(function () { return api.getParent(cur); });
		if (!p || p === cur) break;
		cur = p; d++;
	}
	__depth[id] = d;
	return d;
};

// Step the playhead once, then read every layer at that instant. Values are the
// evaluated ones \u2014 a connected or animated attribute reports what is on screen at
// __rb.frame, not its static default.
var __frame = __rb.frame === null ? __prevFrame : __rb.frame;
if (__frame !== __prevFrame) __read(function () { api.setFrame(__frame); });

var __names = {};
var __total = __ids.length;
var __out = [];
var __truncated = false;
var __nextOffset = -1;
var __index = {};
for (var i = 0; i < __total; i++) __index[__ids[i]] = i;

for (var k = __rb.offset; k < __total; k++) {
	if (Date.now() - __started > __rb.budgetMs) { __truncated = true; __nextOffset = k; break; }
	if (__out.length >= __rb.limit) { __truncated = true; __nextOffset = k; break; }
	var id = __ids[k];
	var type = __read(function () { return api.getLayerType(id); });
	var name = __read(function () { return api.getNiceName(id); });
	__names[id] = name;
	var parent = __read(function () { return api.getParent(id); });
	if (parent && __names[parent] === undefined) {
		__names[parent] = __read(function () { return api.getNiceName(parent); });
	}
	var chain = [];
	var cur = id, guard = 0;
	while (guard++ < 16 && cur) { chain.unshift(__slug(__names[cur] || cur) + '#' + (__index[cur] === undefined ? '?' : __index[cur])); var up = __read(function () { return api.getParent(cur); }); if (!up || up === cur) break; cur = up; }
	// semanticId is index-qualified so it is unique and reproducible from the scene
	// alone. Dropping the suffix would collide as soon as two layers share a label, and
	// resolving collisions by scanning every preceding layer is O(n^2) across the comp \u2014
	// on Cavalry's single thread that is precisely the freeze the budget exists to
	// prevent. semanticSlug carries the bare name for callers that want to group.
	var base = __slug(name || type);
	var semantic = (base || 'layer') + '_' + k;

	var entry = {
		id: id,
		ref: type + '#' + k,
		semanticId: semantic,
		semanticSlug: base,
		type: type,
		name: name,
		path: chain,
		depth: depthOf(id),
		topLevel: __topSet[id] === true,
		inFrame: __read(function () { return api.getInFrame(id); }),
		outFrame: __read(function () { return api.getOutFrame(id); }),
		boundingBox: null,
		pivot: null,
		attrs: {},
		connected: [],
		unreadable: []
	};
	var bb = __box(__read(function () { return api.getBoundingBox(id, true); }));
	if (bb) entry.boundingBox = bb;
	var pv = __read(function () { return api.getPivotPosition(id); });
	if (pv) entry.pivot = { x: __num(Array.isArray(pv) ? pv[0] : pv.x, 0), y: __num(Array.isArray(pv) ? pv[1] : pv.y, 0) };

	var want = __rb.attrs;
	if (__rb.includeAttributes) {
		var declared = __read(function () { return api.getAttributes(id); });
		if (Array.isArray(declared) && declared.length) {
			want = declared.slice(0, 40);
			entry.attributeNames = declared;
		}
	}
	for (var a = 0; a < want.length; a++) {
		var path = want[a];
		var value = __read(function () { return api.get(id, path); });
		// Driven? An attribute fed by a behaviour node or another layer reports the
		// upstream ref here, so a caller can tell a procedural rig from a baked value
		// without a second round trip. This is what refclone keys its tier decisions on.
		var drivenBy = __read(function () { return api.getInConnection(id, path); });
		if (drivenBy) entry.connected.push({ attrPath: path, from: String(drivenBy) });
		if (value === null || value === undefined) { entry.unreadable.push(path); continue; }
		if (Array.isArray(value)) entry.attrs[path] = value.map(function (v) { return __num(v, v); });
		else if (typeof value === 'object') entry.attrs[path] = { x: __num(value.x, value.x), y: __num(value.y, value.y) };
		else entry.attrs[path] = typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ? value : String(value);
	}
	var outs = [];
	for (var o = 0; o < want.length && outs.length < 16; o++) {
		var list = __read(function () { return api.getOutConnections(id, want[o]); });
		if (Array.isArray(list) && list.length) outs.push({ attrPath: want[o], to: list.map(String) });
	}
	if (outs.length) entry.outConnections = outs;
	__out.push(entry);
}

if (__rb.frame !== null && __frame !== __prevFrame) { __read(function () { api.setFrame(__prevFrame); }); }
if (__rb.compId && __prevComp && __rb.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }

return {
	ok: true,
	kind: __rb.kind,
	seq: __rb.seq,
	compId: __compId,
	frame: __frame,
	total: __total,
	offset: __rb.offset,
	returned: __out.length,
	truncated: __truncated,
	nextOffset: __nextOffset,
	elapsedMs: Date.now() - __started,
	layers: __out
};
})()`}function D(a){return`/* cavalry-mcp:atomic */ (function () {
var __sn = ${JSON.stringify(a)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
var __prevComp = __read(function () { return api.getActiveComp(); });
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__sn.compId && __sn.compId !== __prevComp) { __read(function () { api.setActiveComp(__sn.compId); }); }
var __dir = __sn.outDir || (api.getHomeFolder() + '/.stallion/snapshots');
var __target = __dir + '/' + __sn.fileName;
var __ok = true, __error = null, __code = null;
if (!(__sn.compId || __prevComp)) { __ok = false; __error = 'No active comp to render.'; __code = 'STALLION_NO_ACTIVE_COMP'; }
try { if (__ok && __sn.frame !== __prevFrame) api.setFrame(__sn.frame); } catch (e) { __ok = false; __error = String(e && e.message ? e.message : e); __code = 'STALLION_RENDER_FAILED'; }
if (__ok) {
	try { api.renderPNGFrame(__target, __sn.scale); } catch (e2) { __ok = false; __error = String(e2 && e2.message ? e2.message : e2); __code = 'STALLION_RENDER_FAILED'; }
}
var __renderedAt = Date.now();
// Verify the artifact in the same call that produced it: size and existence read back
// straight after renderPNGFrame returns. Without this a caller has to poll the disk to
// learn whether the frame is real, and cannot tell this render from a stale file.
var __bytes = __ok ? __read(function () { return api.getFileSize(__target + '.png'); }) : null;
var __exists = __bytes === null ? __read(function () { return api.filePathExists(__target + '.png'); }) : __bytes > 0;
if (__ok && __bytes !== null && !(__bytes > 0)) { __ok = false; __error = 'renderPNGFrame produced a zero-byte file at ' + __target + '.png'; __code = 'STALLION_RENDER_FAILED'; }
// Deterministic frame digest. Cavalry's script host has no crypto module and cannot
// read the PNG it just wrote back as bytes, so hashing the *file* is not available
// here; what is available \u2014 and what actually answers "which frame is this" \u2014 is a
// digest of the evaluated scene at that frame. Two renders of the same comp at the
// same frame produce the same value, and any change to geometry on that frame changes
// it. Callers that need a content hash of the bytes compute it after reading the file
// over localhost, and the mock bridge fills contentHash in directly.
// Bounded to 64 layers: this is a fingerprint, not a full walk, and it must not eat
// the slice's whole budget.
var __dig = function (str) {
	var hi = 0x811c9dc5, lo = 0x1b873593;
	for (var p = 0; p < str.length; p++) {
		hi ^= str.charCodeAt(p); hi = Math.imul(hi, 0x01000193) >>> 0;
		lo ^= str.charCodeAt(str.length - 1 - p); lo = Math.imul(lo, 0x01000193) >>> 0;
	}
	return ('00000000' + hi.toString(16)).slice(-8) + ('00000000' + lo.toString(16)).slice(-8);
};
var __frameHash = null;
if (__ok) {
	var __sigIds = (__read(function () { return api.getCompLayers(true); }) || []).slice(0, 64);
	var __sig = '';
	for (var q = 0; q < __sigIds.length; q++) {
		var __sid = __sigIds[q];
		var __sbb = __box(__read(function () { return api.getBoundingBox(__sid, true); }));
		__sig += __sid + '|';
		if (__sbb) __sig += [__sbb.x, __sbb.y, __sbb.width, __sbb.height].join(',');
		__sig += ';';
	}
	__frameHash = __dig(String(__sn.frame) + '#' + String(__sn.compId || __prevComp) + '#' + __sig);
}
if (__sn.frame !== __prevFrame) { __read(function () { api.setFrame(__prevFrame); }); }
if (__sn.compId && __prevComp && __sn.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }
return {
	ok: __ok,
	kind: 'snapshot',
	seq: __sn.seq,
	compId: String(__sn.compId || __prevComp),
	frame: __sn.frame,
	file: __target + '.png',
	fileName: __sn.fileName,
	scale: __sn.scale,
	renderedAt: __renderedAt,
	renderedAtIso: new Date(__renderedAt).toISOString(),
	restoredFrame: __prevFrame,
	exists: __exists === true,
	sizeBytes: __bytes === null ? null : Number(__bytes),
	frameHash: __frameHash,
	error: __error,
	code: __code
};
})()`}var E="0.10.0",k="io.scenery.stallion",I="__stallion_result__",N="__stallionResult__",J="render-frames";function u(a){try{return a()}catch{return null}}var g=class{#t;#r;constructor(e,t){this.#t=e,this.#r=t}static loadConfig(){let e={host:"127.0.0.1",port:8080,token:""},t=u(()=>api.getAppDataFolder());if(!t||typeof t!="string")return e;let r=t.replace(/[\\/]$/,"")+"/stallion.json";if(u(()=>api.filePathExists(r))!==!0)return e;let n=u(()=>JSON.parse(api.readFromFile(r)));return!n||typeof n!="object"?e:{host:typeof n.host=="string"&&n.host?n.host:e.host,port:typeof n.port=="number"&&Number.isFinite(n.port)&&n.port>0&&n.port<65536?Math.floor(n.port):e.port,token:typeof n.token=="string"?n.token:e.token}}#e=e=>{u(()=>{this.#t.setResultForGet(typeof e=="string"?e:JSON.stringify(e))})};serveStatus=()=>{this.#e({kind:"status",stallion:E,cavalry:u(()=>api.getCavalryVersion()),scene:u(()=>api.getSceneFilePath()),frame:u(()=>api.getFrame()),unSaved:u(()=>api.sceneHasUnsavedChanges()),capabilities:{receipt:!0,renderFrames:!0,introspect:["state","layers","snapshot"],errorEnvelope:1,mock:!1},ts:Date.now()})};#o=e=>{let t=u(()=>globalThis[N]);if(typeof t!="string")return;let r=u(()=>JSON.parse(t));r&&r.seq===e&&this.#e(t)};onPost=()=>{this.#i(u(()=>this.#t.getNextPost()));let e=64;for(;e-- >0;){let t=u(()=>this.#t.postCount());if(typeof t!="number"||!Number.isFinite(t)||t<1)break;this.#i(u(()=>this.#t.getNextPost()))}};#i=e=>{if(!e||typeof e.result!="string"){console.error("Stallion: No post data");return}let t=u(()=>JSON.parse(e.result));if(!t||typeof t!="object"){console.error("Stallion: Failed to parse request as JSON");return}if(console.log("Stallion: Data received"),t.type===I){this.#e(e.result);return}if(t.type===J){this.#l(t);return}if(t.type===w||t.type===R){this.#s(t.type===w?"state":"layers",t);return}if(t.type===h){this.#_(t);return}let{type:r,code:n,path:o,seq:s,statePath:i}=t;if(!r&&!o){console.error("Stallion: Missing/empty `type` key in request");return}if(!n&&!o){console.error("Stallion: Missing/empty `code` or `path` key in request");return}if(r==="script"||o){if(n&&o&&console.warn("Stallion: `code` and `path` keys are both in the request, executing `path`"),o){if(!api.filePathExists(o)){this.#e({kind:"result",seq:s,ok:!1,error:`No script found at ${o}`}),console.error(`Stallion: No script found at ${o}`);return}if(ui.runFileScript(o)){this.#e({kind:"result",seq:s,ok:!0,note:"file script executed (no captured result)"}),console.log("Stallion: Script successfully executed");return}this.#e({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(n){let _=api.exec(k,this.#n(n,s,i,{beatFrames:t.beatFrames,diagnostics:t.diagnostics===!0}));if(this.#o(s),_){console.log("Stallion: Script successfully executed");return}this.#e({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}this.#e({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(typeof r=="string"&&(r.startsWith("javaScript")||r.startsWith("sksl"))){let _=api.getSelection();_.length||(_=[api.create(r)]);let c="expression";r==="javaScriptShape"&&(c="generator.expression"),r.startsWith("sksl")&&(c="code");let d=[],l=[];for(let f of _){if(api.getLayerType(f)!==r){let v=api.getNiceName(f);l.push(String(v)),console.warn(`Stallion: Skipped layer '${v}' because it is not of type '${r}'`);continue}api.set(f,{[c]:n}),d.push(String(f))}this.#e({kind:"result",seq:s,ok:!0,applied:d,skipped:l}),console.log("Stallion: Successfully applied expression");return}if(typeof r=="string"&&r.toLowerCase().includes("render")){let _=api.getRenderQueueItems(),c=[];for(let d of _)api.get(d,"selected")&&(api.set(d,{[r]:n}),c.push(String(d)));this.#e({kind:"result",seq:s,ok:!0,applied:c}),console.log("Stallion: Successfully applied render expression");return}this.#e({kind:"result",seq:s,ok:!1,error:`Unexpected type '${r}'`}),console.error(`Stallion: Unexpected type '${r}'`)};#n=(e,t,r,n)=>{let o=`http://${this.#r.host}:${this.#r.port}`,s=this.#r.token,i=JSON.stringify(t)??"undefined",_=JSON.stringify(r??""),c=e.startsWith("/* cavalry-mcp:atomic */"),d=c?e:`(() => {
	var __undo = typeof api.startUndoGroup === 'function';
	if (__undo) api.startUndoGroup('AI Motion Batch');
	try {
		return (() => { ${e}
})();
	} finally {
		if (__undo) api.endUndoGroup();
	}
})()`,l=c?"":`var __telemetry = (function () {
	var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
	var __top = function () { var ids = __read(function () { return api.getCompLayers(true); }); return Array.isArray(ids) ? ids : []; };
	var __before = __top();
	var __started = Date.now();
	var __snapshot = {
		seq: ${i}, status: 'ok', errorStack: null, createdLayerIds: [],
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
				try { api.writeToFile(__statePath, JSON.stringify({ seq: ${i}, status: __snapshot.status, errorStack: __snapshot.errorStack, writeFailed: String(writeErr) }), true); } catch (e) {}
			}
			try { globalThis.__stallionState = __snapshot; } catch (e) {}
		} catch (e) {}
	};
	return { snapshot: __snapshot, finalize: __finalize };
})()`,f=c?`try {
	var __shared = globalThis.__stallionState;
	if (__shared && __shared.seq === ${i}) __state = __shared;
} catch (e) {}`:`if (__telemetry && __telemetry.finalize) {
	__telemetry.finalize();
	__state = __telemetry.snapshot;
}`,F=Array.isArray(n?.beatFrames)?n.beatFrames.map(x=>Math.round(Number(x))).filter(x=>Number.isFinite(x)).slice(0,32):[],v=n?.diagnostics===!0?`(function () {
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
				// 2.8 returns a string, and an attribute with no input is "" rather than
				// null \u2014 an empty string read back after connect() is a dead connection.
				// The array branch stays for hosts that answer with a list.
				var dead = link === null || link === undefined || link === '' || (Array.isArray(link) && link.length === 0);
				if (dead) __diag.failedConnections.push(String(srcId) + ':' + String(srcAttr) + '->' + String(dstId) + ':' + String(dstAttr));
				return result;
			};
		} catch (e) { __consoleLog.push({ level: 'warn', text: 'Stallion: api.connect probe unavailable' }); }
	}
})();`:"";return`(function () {
var __deliver = function (payload) {
	try { globalThis.${N} = payload; } catch (e) {}
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
${C}
var __state = null;
${l}
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
${v}
var __out = { type: ${JSON.stringify(I)}, kind: 'result', seq: ${i}, ok: true };
try {
	var __result;
	var __returned = ${d};
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
${f}
if (__state) {
	if (__out.ok === false && __state.status !== 'error') { __state.status = 'error'; __state.errorStack = __out.stack || __out.error || null; }
	__out.state = __state;
}
try {
	var __receiptIds = [];
	if (__state && Array.isArray(__state.createdLayerIds)) __receiptIds = __receiptIds.concat(__state.createdLayerIds);
	if (__state && Array.isArray(__state.activeSelection)) __receiptIds = __receiptIds.concat(__state.activeSelection);
	var __beatFrames = ${JSON.stringify(F)};
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
	__json = JSON.stringify({ type: ${JSON.stringify(I)}, kind: 'result', seq: ${i}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`};#a=(e,t)=>{let r=u(()=>globalThis[N]);if(typeof r!="string")return;let n=u(()=>JSON.parse(r));!n||n.seq!==e||this.#e(JSON.stringify(t(n)))};#s=(e,t)=>{let r=t.seq,n=typeof t.mgCall=="string"?t.mgCall:void 0,o=T(e,t),s=api.exec(k,this.#n(L(o),r));if(this.#a(r,i=>{let _=typeof i.result=="object"&&i.result!==null?i.result:{};return{..._,seq:i.seq,kind:e,ok:i.ok===!0&&_.ok!==!1}}),!s){this.#e(S(e,y.EXEC_FAILED,`${e} readback failed to execute in the Cavalry script host.`,{seq:r,mgCall:n})),console.error(`Stallion: ${e} readback failed to execute`);return}};#_=e=>{let t=e.seq,r=typeof e.mgCall=="string"?e.mgCall:void 0,n=O(e);if("error"in n){this.#e(S(h,n.code,n.error,{seq:t,mgCall:r})),console.error(`Stallion: snapshot rejected \u2014 ${n.error}`);return}let o=n.job,s=api.exec(k,this.#n(D(o),t));if(this.#a(t,i=>{let _=typeof i.result=="object"&&i.result!==null?i.result:{};return{..._,seq:i.seq,kind:h,ok:i.ok===!0&&_.ok!==!1}}),!s){this.#e(S(h,y.EXEC_FAILED,"Snapshot script failed to execute in the Cavalry script host.",{seq:t,mgCall:r})),console.error("Stallion: snapshot script failed to execute");return}};#l=e=>{let t=e.seq,n=(Array.isArray(e.frames)?e.frames:[]).map(l=>Math.round(Number(l))).filter(l=>Number.isFinite(l)&&Math.abs(l)<1e9);if(!n.length){this.#e({kind:"render-frames",seq:t,ok:!1,error:"render-frames requires a non-empty frames array"});return}if(n.length>2e3){this.#e({kind:"render-frames",seq:t,ok:!1,error:"render-frames accepts at most 2000 frames per batch"});return}let o=Number(e.resolutionScale),s=Number.isFinite(o)&&o>0?Math.min(4,Math.max(.01,o)):.5,i=e.format==="raw_rgba"?"raw_rgba":"png_buffer",_=typeof e.compId=="string"&&e.compId.trim()?e.compId.trim():"",c=typeof e.outDir=="string"&&e.outDir.trim()?e.outDir.trim():"",d=api.exec(k,U({frames:n,scale:s,format:i,compId:_,outDir:c,seq:t}));if(this.#a(t,l=>{let f=typeof l.result=="object"&&l.result!==null?l.result:{};return{...f,type:l.type,seq:l.seq,kind:"render-frames",ok:l.ok===!0&&f.ok!==!1}}),!d){this.#e({kind:"render-frames",seq:t,ok:!1,error:"Script failed to execute"}),console.error("Stallion: render-frames script failed to execute");return}console.log("Stallion: render-frames batch executed")}};function U(a){return`var __rf = ${JSON.stringify(a)};
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
};`}var P="2.4.0",X=cavalry.versionLessThan(P);if(X)throw new Error(`Stallion requires Cavalry ${P} or higher`);var p=g.loadConfig(),b=new api.WebServer,M=new g(b,p);b.listen(p.host,p.port);b.addCallbackObject(M);b.setHighFrequency();p.token&&(b.setTokenAuthentication(p.token),console.warn("Stallion: token authentication enabled via stallion.json"));M.serveStatus();var q={CENTRE:1},j=new ui.Label(`v${E} \u2014 listening on ${p.host}:${p.port}`);j.setAlignment(q.CENTRE);var B=new ui.Label("[Documentation](https://github.com/akspro9866-art/stallion#readme)");B.setAlignment(q.CENTRE);var A=new ui.VLayout;A.addStretch();A.add(j,B);A.addStretch();ui.setTitle("Stallion");ui.add(A);ui.show();})();
