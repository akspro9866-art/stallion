// VERSION 0.9.0
// This is the compiled version
// Read the source at https://github.com/akspro9866-art/stallion.git
(()=>{var y="0.9.0",$="io.scenery.stallion",S="__stallion_result__",v="__stallionResult__";function o(k){try{return k()}catch{return null}}var f=class{#e;#n;constructor(t,s){this.#e=t,this.#n=s}static loadConfig(){let t={host:"127.0.0.1",port:8080,token:""},s=o(()=>api.getAppDataFolder());if(!s||typeof s!="string")return t;let e=s.replace(/[\\/]$/,"")+"/stallion.json";if(o(()=>api.filePathExists(e))!==!0)return t;let n=o(()=>JSON.parse(api.readFromFile(e)));return!n||typeof n!="object"?t:{host:typeof n.host=="string"&&n.host?n.host:t.host,port:typeof n.port=="number"&&Number.isFinite(n.port)&&n.port>0&&n.port<65536?Math.floor(n.port):t.port,token:typeof n.token=="string"?n.token:t.token}}#t=t=>{o(()=>{this.#e.setResultForGet(typeof t=="string"?t:JSON.stringify(t))})};serveStatus=()=>{this.#t({kind:"status",stallion:y,cavalry:o(()=>api.getCavalryVersion()),scene:o(()=>api.getSceneFilePath()),frame:o(()=>api.getFrame()),unSaved:o(()=>api.sceneHasUnsavedChanges()),ts:Date.now()})};#o=t=>{let s=o(()=>globalThis[v]);if(typeof s!="string")return;let e=o(()=>JSON.parse(s));e&&e.seq===t&&this.#t(s)};onPost=()=>{this.#s(o(()=>this.#e.getNextPost()));let t=64;for(;t-- >0;){let s=o(()=>this.#e.postCount());if(typeof s!="number"||!Number.isFinite(s)||s<1)break;this.#s(o(()=>this.#e.getNextPost()))}};#s=t=>{if(!t||typeof t.result!="string"){console.error("Stallion: No post data");return}let s=o(()=>JSON.parse(t.result));if(!s||typeof s!="object"){console.error("Stallion: Failed to parse request as JSON");return}if(console.log("Stallion: Data received"),s.type===S){this.#t(t.result);return}let{type:e,code:n,path:r,seq:i}=s;if(!e&&!r){console.error("Stallion: Missing/empty `type` key in request");return}if(!n&&!r){console.error("Stallion: Missing/empty `code` or `path` key in request");return}if(e==="script"||r){if(n&&r&&console.warn("Stallion: `code` and `path` keys are both in the request, executing `path`"),r){if(!api.filePathExists(r)){this.#t({kind:"result",seq:i,ok:!1,error:`No script found at ${r}`}),console.error(`Stallion: No script found at ${r}`);return}if(ui.runFileScript(r)){this.#t({kind:"result",seq:i,ok:!0,note:"file script executed (no captured result)"}),console.log("Stallion: Script successfully executed");return}this.#t({kind:"result",seq:i,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(n){let a=api.exec($,this.#r(n,i));if(this.#o(i),a){console.log("Stallion: Script successfully executed");return}this.#t({kind:"result",seq:i,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}this.#t({kind:"result",seq:i,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(typeof e=="string"&&(e.startsWith("javaScript")||e.startsWith("sksl"))){let a=api.getSelection();a.length||(a=[api.create(e)]);let l="expression";e==="javaScriptShape"&&(l="generator.expression"),e.startsWith("sksl")&&(l="code");let u=[],g=[];for(let p of a){if(api.getLayerType(p)!==e){let _=api.getNiceName(p);g.push(String(_)),console.warn(`Stallion: Skipped layer '${_}' because it is not of type '${e}'`);continue}api.set(p,{[l]:n}),u.push(String(p))}this.#t({kind:"result",seq:i,ok:!0,applied:u,skipped:g}),console.log("Stallion: Successfully applied expression");return}if(typeof e=="string"&&e.toLowerCase().includes("render")){let a=api.getRenderQueueItems(),l=[];for(let u of a)api.get(u,"selected")&&(api.set(u,{[e]:n}),l.push(String(u)));this.#t({kind:"result",seq:i,ok:!0,applied:l}),console.log("Stallion: Successfully applied render expression");return}this.#t({kind:"result",seq:i,ok:!1,error:`Unexpected type '${e}'`}),console.error(`Stallion: Unexpected type '${e}'`)};#r=(t,s)=>{let e=`http://${this.#n.host}:${this.#n.port}`,n=this.#n.token,r=JSON.stringify(s)??"undefined",i=t.startsWith("/* cavalry-mcp:atomic */")?t:`(() => {
	api.startUndoGroup('AI Motion Batch');
	try {
		return (() => { ${t}
})();
	} finally {
		api.endUndoGroup();
	}
})()`;return`(function () {
var __deliver = function (payload) {
	try { globalThis.${v} = payload; } catch (e) {}
	try {
		var __client = new api.WebClient(${JSON.stringify(e)});
		${n?`__client.setTokenAuthentication(${JSON.stringify(n)});`:""}
		__client.post('/post', payload, 'application/json');
	} catch (e) {}
};
var __out = { type: ${JSON.stringify(S)}, kind: 'result', seq: ${r}, ok: true };
try {
	var __result;
	var __returned = ${i};
	if (typeof __result === 'undefined') __result = __returned;
	if (typeof __result !== 'undefined') __out.result = __result;
} catch (err) {
	__out.ok = false;
	__out.error = err.toString();
	__out.stack = err.stack;
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(S)}, kind: 'result', seq: ${r}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`}};var b="2.4.0",T=cavalry.versionLessThan(b);if(T)throw new Error(`Stallion requires Cavalry ${b} or higher`);var c=f.loadConfig(),d=new api.WebServer,w=new f(d,c);d.listen(c.host,c.port);d.addCallbackObject(w);d.setHighFrequency();c.token&&(d.setTokenAuthentication(c.token),console.warn("Stallion: token authentication enabled via stallion.json"));w.serveStatus();var N={CENTRE:1},m=new ui.Label(`v${y} \u2014 listening on ${c.host}:${c.port}`);m.setAlignment(N.CENTRE);var x=new ui.Label("[Documentation](https://github.com/akspro9866-art/stallion#readme)");x.setAlignment(N.CENTRE);var h=new ui.VLayout;h.addStretch();h.add(m,x);h.addStretch();ui.setTitle("Stallion");ui.add(h);ui.show();})();
