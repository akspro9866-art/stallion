// VERSION 0.9.0
// This is the compiled version
// Read the source at https://github.com/akspro9866-art/stallion.git
(()=>{var S="0.9.0",$="io.scenery.stallion",g="__stallion_result__",k="__stallionResult__";function o(m){try{return m()}catch{return null}}var d=class{#e;#r;constructor(t,n){this.#e=t,this.#r=n}static loadConfig(){let t={host:"127.0.0.1",port:8080,token:""},n=o(()=>api.getAppDataFolder());if(!n||typeof n!="string")return t;let e=n.replace(/[\\/]$/,"")+"/stallion.json";if(o(()=>api.filePathExists(e))!==!0)return t;let r=o(()=>JSON.parse(api.readFromFile(e)));return!r||typeof r!="object"?t:{host:typeof r.host=="string"&&r.host?r.host:t.host,port:typeof r.port=="number"&&Number.isFinite(r.port)&&r.port>0&&r.port<65536?Math.floor(r.port):t.port,token:typeof r.token=="string"?r.token:t.token}}#t=t=>{o(()=>{this.#e.setResultForGet(typeof t=="string"?t:JSON.stringify(t))})};serveStatus=()=>{this.#t({kind:"status",stallion:S,cavalry:o(()=>api.getCavalryVersion()),scene:o(()=>api.getSceneFilePath()),frame:o(()=>api.getFrame()),unSaved:o(()=>api.sceneHasUnsavedChanges()),ts:Date.now()})};#s=t=>{let n=o(()=>globalThis[k]);if(typeof n!="string")return;let e=o(()=>JSON.parse(n));e&&e.seq===t&&this.#t(n)};onPost=()=>{this.#n(o(()=>this.#e.getNextPost()));let t=64;for(;t-- >0;){let n=o(()=>this.#e.postCount());if(typeof n!="number"||!Number.isFinite(n)||n<1)break;this.#n(o(()=>this.#e.getNextPost()))}};#n=t=>{if(!t||typeof t.result!="string"){console.error("Stallion: No post data");return}let n=o(()=>JSON.parse(t.result));if(!n||typeof n!="object"){console.error("Stallion: Failed to parse request as JSON");return}if(console.log("Stallion: Data received"),n.type===g){this.#t(t.result);return}let{type:e,code:r,path:i,seq:s,statePath:y}=n;if(!e&&!i){console.error("Stallion: Missing/empty `type` key in request");return}if(!r&&!i){console.error("Stallion: Missing/empty `code` or `path` key in request");return}if(e==="script"||i){if(r&&i&&console.warn("Stallion: `code` and `path` keys are both in the request, executing `path`"),i){if(!api.filePathExists(i)){this.#t({kind:"result",seq:s,ok:!1,error:`No script found at ${i}`}),console.error(`Stallion: No script found at ${i}`);return}if(ui.runFileScript(i)){this.#t({kind:"result",seq:s,ok:!0,note:"file script executed (no captured result)"}),console.log("Stallion: Script successfully executed");return}this.#t({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(r){let a=api.exec($,this.#o(r,s,y));if(this.#s(s),a){console.log("Stallion: Script successfully executed");return}this.#t({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}this.#t({kind:"result",seq:s,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(typeof e=="string"&&(e.startsWith("javaScript")||e.startsWith("sksl"))){let a=api.getSelection();a.length||(a=[api.create(e)]);let l="expression";e==="javaScriptShape"&&(l="generator.expression"),e.startsWith("sksl")&&(l="code");let u=[],_=[];for(let p of a){if(api.getLayerType(p)!==e){let b=api.getNiceName(p);_.push(String(b)),console.warn(`Stallion: Skipped layer '${b}' because it is not of type '${e}'`);continue}api.set(p,{[l]:r}),u.push(String(p))}this.#t({kind:"result",seq:s,ok:!0,applied:u,skipped:_}),console.log("Stallion: Successfully applied expression");return}if(typeof e=="string"&&e.toLowerCase().includes("render")){let a=api.getRenderQueueItems(),l=[];for(let u of a)api.get(u,"selected")&&(api.set(u,{[e]:r}),l.push(String(u)));this.#t({kind:"result",seq:s,ok:!0,applied:l}),console.log("Stallion: Successfully applied render expression");return}this.#t({kind:"result",seq:s,ok:!1,error:`Unexpected type '${e}'`}),console.error(`Stallion: Unexpected type '${e}'`)};#o=(t,n,e)=>{let r=`http://${this.#r.host}:${this.#r.port}`,i=this.#r.token,s=JSON.stringify(n)??"undefined",y=JSON.stringify(e??""),a=t.startsWith("/* cavalry-mcp:atomic */"),l=a?t:`(() => {
	var __undo = typeof api.startUndoGroup === 'function';
	if (__undo) api.startUndoGroup('AI Motion Batch');
	try {
		return (() => { ${t}
})();
	} finally {
		if (__undo) api.endUndoGroup();
	}
})()`,u=a?"":`var __telemetry = (function () {
	var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
	var __top = function () { var ids = __read(function () { return api.getCompLayers(true); }); return Array.isArray(ids) ? ids : []; };
	var __before = __top();
	var __started = Date.now();
	var __snapshot = {
		seq: ${s}, status: 'ok', errorStack: null, createdLayerIds: [],
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
				try { api.writeToFile(__statePath, JSON.stringify({ seq: ${s}, status: __snapshot.status, errorStack: __snapshot.errorStack, writeFailed: String(writeErr) }), true); } catch (e) {}
			}
			try { globalThis.__stallionState = __snapshot; } catch (e) {}
		} catch (e) {}
	};
	return { snapshot: __snapshot, finalize: __finalize };
})()`,_=a?`try {
	var __shared = globalThis.__stallionState;
	if (__shared && __shared.seq === ${s}) __state = __shared;
} catch (e) {}`:`if (__telemetry && __telemetry.finalize) {
	__telemetry.finalize();
	__state = __telemetry.snapshot;
}`;return`(function () {
var __deliver = function (payload) {
	try { globalThis.${k} = payload; } catch (e) {}
	try {
		var __client = new api.WebClient(${JSON.stringify(r)});
		${i?`__client.setTokenAuthentication(${JSON.stringify(i)});`:""}
		__client.post('/post', payload, 'application/json');
	} catch (e) {}
};
var __statePath = ${y};
if (!__statePath) {
	try { __statePath = api.getHomeFolder() + '/.cavalry-mcp/last-execution-state.json'; } catch (e) {}
}
var __state = null;
${u}
if (typeof __telemetry !== 'undefined' && __telemetry && __telemetry.snapshot) __state = __telemetry.snapshot;
var __out = { type: ${JSON.stringify(g)}, kind: 'result', seq: ${s}, ok: true };
try {
	var __result;
	var __returned = ${l};
	if (typeof __result === 'undefined') __result = __returned;
	if (typeof __result !== 'undefined') __out.result = __result;
} catch (err) {
	__out.ok = false;
	__out.error = err.toString();
	__out.stack = err.stack;
	if (__state) { __state.status = 'error'; __state.errorStack = String(err.stack || err); }
}
${_}
if (__state) {
	if (__out.ok === false && __state.status !== 'error') { __state.status = 'error'; __state.errorStack = __out.stack || __out.error || null; }
	__out.state = __state;
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(g)}, kind: 'result', seq: ${s}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`}};var v="2.4.0",P=cavalry.versionLessThan(v);if(P)throw new Error(`Stallion requires Cavalry ${v} or higher`);var c=d.loadConfig(),f=new api.WebServer,N=new d(f,c);f.listen(c.host,c.port);f.addCallbackObject(N);f.setHighFrequency();c.token&&(f.setTokenAuthentication(c.token),console.warn("Stallion: token authentication enabled via stallion.json"));N.serveStatus();var x={CENTRE:1},w=new ui.Label(`v${S} \u2014 listening on ${c.host}:${c.port}`);w.setAlignment(x.CENTRE);var F=new ui.Label("[Documentation](https://github.com/akspro9866-art/stallion#readme)");F.setAlignment(x.CENTRE);var h=new ui.VLayout;h.addStretch();h.add(w,F);h.addStretch();ui.setTitle("Stallion");ui.add(h);ui.show();})();
