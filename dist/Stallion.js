// VERSION 0.9.0
// This is the compiled version
// Read the source at https://github.com/akspro9866-art/stallion.git
(()=>{var y="0.9.0",$="io.scenery.stallion",S="__stallion_result__",v="__stallionResult__";function o(_){try{return _()}catch{return null}}var f=class{#t;#s;constructor(e,n){this.#t=e,this.#s=n}static loadConfig(){let e={host:"127.0.0.1",port:8080,token:""},n=o(()=>api.getAppDataFolder());if(!n||typeof n!="string")return e;let t=n.replace(/[\\/]$/,"")+"/stallion.json";if(o(()=>api.filePathExists(t))!==!0)return e;let s=o(()=>JSON.parse(api.readFromFile(t)));return!s||typeof s!="object"?e:{host:typeof s.host=="string"&&s.host?s.host:e.host,port:typeof s.port=="number"&&Number.isFinite(s.port)&&s.port>0&&s.port<65536?Math.floor(s.port):e.port,token:typeof s.token=="string"?s.token:e.token}}#e=e=>{o(()=>{this.#t.setResultForGet(typeof e=="string"?e:JSON.stringify(e))})};serveStatus=()=>{this.#e({kind:"status",stallion:y,cavalry:o(()=>api.getCavalryVersion()),scene:o(()=>api.getSceneFilePath()),frame:o(()=>api.getFrame()),unSaved:o(()=>api.sceneHasUnsavedChanges()),ts:Date.now()})};#o=e=>{let n=o(()=>globalThis[v]);if(typeof n!="string")return;let t=o(()=>JSON.parse(n));t&&t.seq===e&&this.#e(n)};onPost=()=>{this.#n(o(()=>this.#t.getNextPost()));let e=64;for(;e-- >0;){let n=o(()=>this.#t.postCount());if(typeof n!="number"||!Number.isFinite(n)||n<1)break;this.#n(o(()=>this.#t.getNextPost()))}};#n=e=>{if(!e||typeof e.result!="string"){console.error("Stallion: No post data");return}let n=o(()=>JSON.parse(e.result));if(!n||typeof n!="object"){console.error("Stallion: Failed to parse request as JSON");return}if(console.log("Stallion: Data received"),n.type===S){this.#e(e.result);return}let{type:t,code:s,path:r,seq:i}=n;if(!t&&!r){console.error("Stallion: Missing/empty `type` key in request");return}if(!s&&!r){console.error("Stallion: Missing/empty `code` or `path` key in request");return}if(t==="script"||r){if(s&&r&&console.warn("Stallion: `code` and `path` keys are both in the request, executing `path`"),r){if(!api.filePathExists(r)){this.#e({kind:"result",seq:i,ok:!1,error:`No script found at ${r}`}),console.error(`Stallion: No script found at ${r}`);return}if(ui.runFileScript(r)){this.#e({kind:"result",seq:i,ok:!0,note:"file script executed (no captured result)"}),console.log("Stallion: Script successfully executed");return}this.#e({kind:"result",seq:i,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(s){let a=api.exec($,this.#r(s,i));if(this.#o(i),a){console.log("Stallion: Script successfully executed");return}this.#e({kind:"result",seq:i,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}this.#e({kind:"result",seq:i,ok:!1,error:"Script failed to execute"}),console.error("Stallion: Script failed to execute");return}if(typeof t=="string"&&(t.startsWith("javaScript")||t.startsWith("sksl"))){let a=api.getSelection();a.length||(a=[api.create(t)]);let l="expression";t==="javaScriptShape"&&(l="generator.expression"),t.startsWith("sksl")&&(l="code");let u=[],g=[];for(let p of a){if(api.getLayerType(p)!==t){let k=api.getNiceName(p);g.push(String(k)),console.warn(`Stallion: Skipped layer '${k}' because it is not of type '${t}'`);continue}api.set(p,{[l]:s}),u.push(String(p))}this.#e({kind:"result",seq:i,ok:!0,applied:u,skipped:g}),console.log("Stallion: Successfully applied expression");return}if(typeof t=="string"&&t.toLowerCase().includes("render")){let a=api.getRenderQueueItems(),l=[];for(let u of a)api.get(u,"selected")&&(api.set(u,{[t]:s}),l.push(String(u)));this.#e({kind:"result",seq:i,ok:!0,applied:l}),console.log("Stallion: Successfully applied render expression");return}this.#e({kind:"result",seq:i,ok:!1,error:`Unexpected type '${t}'`}),console.error(`Stallion: Unexpected type '${t}'`)};#r=(e,n)=>{let t=`http://${this.#s.host}:${this.#s.port}`,s=this.#s.token,r=JSON.stringify(n)??"undefined";return`(function () {
var __deliver = function (payload) {
	try { globalThis.${v} = payload; } catch (e) {}
	try {
		var __client = new api.WebClient(${JSON.stringify(t)});
		${s?`__client.setTokenAuthentication(${JSON.stringify(s)});`:""}
		__client.post('/post', payload, 'application/json');
	} catch (e) {}
};
var __out = { type: ${JSON.stringify(S)}, kind: 'result', seq: ${r}, ok: true };
try {
	var __result;
	var __returned = (function () { ${e} 
})();
	if (typeof __result === 'undefined') __result = __returned;
	if (typeof __result !== 'undefined') __out.result = __result;
} catch (e) {
	__out.ok = false;
	__out.error = String(e && e.message ? e.message : e);
}
var __json;
try { __json = JSON.stringify(__out); } catch (e2) {
	__json = JSON.stringify({ type: ${JSON.stringify(S)}, kind: 'result', seq: ${r}, ok: false, error: 'Script result was not serialisable' });
}
__deliver(__json);
})()`}};var b="2.4.0",T=cavalry.versionLessThan(b);if(T)throw new Error(`Stallion requires Cavalry ${b} or higher`);var c=f.loadConfig(),d=new api.WebServer,N=new f(d,c);d.listen(c.host,c.port);d.addCallbackObject(N);d.setHighFrequency();c.token&&(d.setTokenAuthentication(c.token),console.warn("Stallion: token authentication enabled via stallion.json"));N.serveStatus();var x={CENTRE:1},m=new ui.Label(`v${y} \u2014 listening on ${c.host}:${c.port}`);m.setAlignment(x.CENTRE);var w=new ui.Label("[Documentation](https://github.com/akspro9866-art/stallion#readme)");w.setAlignment(x.CENTRE);var h=new ui.VLayout;h.addStretch();h.add(m,w);h.addStretch();ui.setTitle("Stallion");ui.add(h);ui.show();})();
