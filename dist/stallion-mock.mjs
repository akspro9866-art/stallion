#!/usr/bin/env node
// VERSION 0.10.0 (mock bridge)
import{pathToFileURL as bt}from"node:url";import dt from"node:http";import ft from"node:vm";import xe from"node:path";import T from"node:fs";import{createHash as Pe}from"node:crypto";import q from"node:fs";import Ie from"node:os";import X from"node:path";var _=i=>({kind:"number",default:i}),j=(i,e)=>({kind:"point",default:[i,e]}),me=i=>({kind:"color",default:i}),E=(i="")=>({kind:"string",default:i}),B=(i=!1)=>({kind:"bool",default:i}),C={kind:"any"},H={is3d:B(!1),blendMode:E("normal"),masks:C,clippingMode:C,deformers:C,drawOnTopOfParent:B(!1),excludeFromLayout:B(!1),featherAmount:_(0),featherMasks:C,filters:C,posterizeFrameRate:_(0),frozen:B(!1),guideLayer:B(!1),hidden:B(!1),layoutFrame:_(0),forceLottieBake:B(!1),webExport:B(!1),motionBlur:B(!1),multiStroke:B(!1),posterizeTimeOffset:_(0),opacity:_(1),pivot:j(0,0),position:j(0,0),posterizeTime:_(0),rotation:_(0),scale:j(100,100),skew:_(0),stroke:C,matteMode:C,trackMattes:C,name:E(),id:E()},Z={generator:C,"generator.dimensions":j(100,100),"generator.cornerRadius":_(0),"generator.chamfer":_(0),"generator.divisions":_(0),"generator.radiusTop":_(0),"generator.radiusBottom":_(0),"generator.vectorize":B(!1),material:C,"material.materialColor":me("#ffffff"),"material.alpha":_(1),"material.colorShaders":C},We={text:E(),font:E("Inter"),fontSize:_(24),letterSpacing:_(0),wordSpacing:_(0),lineSpacing:_(1.2),paragraphSpacing:_(0),textBoxSize:j(0,0),horizontalAlignment:E("left"),autoName:B(!0),style:C,pathTravel:_(0),pathPush:_(0),pathLoop:B(!1)},_e={compNode:{visual:!1,attributes:{resolution:j(1920,1080),"resolution.x":_(1920),"resolution.y":_(1080),fps:_(24),backgroundColor:me("#000000"),startFrame:_(0),endFrame:_(215)}},basicShape:{visual:!0,attributes:{...H,...Z}},ellipseShape:{visual:!0,attributes:{...H,...Z}},rectangleShape:{visual:!0,attributes:{...H,...Z}},polygonShape:{visual:!0,attributes:{...H,...Z}},starShape:{visual:!0,attributes:{...H,...Z}},editableShape:{visual:!0,attributes:{...H,inputPath:E(),fillRule:C,...Z}},textShape:{visual:!0,attributes:{...H,...We}},group:{visual:!0,attributes:{...H,groupMode:C}},image:{visual:!0,attributes:{...H,assetPath:E()}},preComp:{visual:!0,attributes:{...H}},duplicator:{visual:!1,attributes:{distribution:E("linear"),count:_(2),size:j(100,100),staggerOffset:_(0),generator:C}},falloff:{visual:!1,attributes:{falloffType:E("linear"),influence:_(1),radius:_(100),position:j(0,0)}},stagger:{visual:!1,attributes:{delayFrames:_(4),staggerType:E("temporal")}},noise:{visual:!1,attributes:{frequency:_(1),timeScale:_(1),seed:_(0),amplitude:_(1)}},oscillator:{visual:!1,attributes:{frequency:_(1),amplitude:_(1),phase:_(0),waveType:E("sine")}},subMesh:{visual:!1,attributes:{subMeshLevel:_(0)}},travel:{visual:!1,attributes:{travel:_(0),start:_(0),end:_(100)}},bevel:{visual:!1,attributes:{bevelRadius:_(4),cornerRadius:_(4)}},boolean:{visual:!1,attributes:{booleanMode:E("union")}},pathfinder:{visual:!1,attributes:{pathfinderMode:E("union")}},blurFilter:{visual:!1,attributes:{blurRadius:_(4)}},gaussianBlurFilter:{visual:!1,attributes:{blurRadius:_(4)}},dropShadowFilter:{visual:!1,attributes:{shadowRadius:_(4),shadowOffsetX:_(0),shadowOffsetY:_(4),shadowColor:me("#000000"),shadowOpacity:_(.5)}},innerShadowFilter:{visual:!1,attributes:{shadowRadius:_(4)}},grainFilter:{visual:!1,attributes:{grainAmount:_(.2)}},backgroundBlurFilter:{visual:!1,attributes:{blurRadius:_(4)}},connectShape:{visual:!1,attributes:{targetMode:C,maxConnections:_(10),curve:B(!1)}},meshDistribution:{visual:!1,attributes:{distribution:E("linear")}},null:{visual:!1,attributes:{}},camera:{visual:!1,attributes:{}}},Qe={visual:!1,attributes:{}};function se(i){return _e[i]??Qe}function W(i,e){let t=se(i);if(e in t.attributes)return!0;let r=e.lastIndexOf(".");if(r>0){let n=e.slice(0,r);if(n in t.attributes||W(i,n))return!0}return!1}function he(i,e){return W(i,e)||e==="deformers"||e==="generator"||e==="masks"}function Y(i){throw new Error(`mock api: ${i}`)}var ae=class{scene;options;lastFrames=[];constructor(e,t={}){this.scene=e,this.options=t,e.createComp()}create(e,t,r){return this.scene.createLayer(String(e),t?String(t):void 0).id}primitive(e,t){let r=this.scene.createLayer("basicShape",t);return this.scene.setAttr(r,"generator",`${e}Shape`),r.id}setGenerator(e,t,r){let n=this.#e(e);t!=="generator"&&Y(`setGenerator supports the 'generator' attribute, got '${t}'`),this.scene.setAttr(n,"generator",r)}set(e,t){let r=this.#e(e);for(let[n,o]of Object.entries(t??{}))this.scene.setAttr(r,n,o);this.#r(r)}#r(e){if(e.type!=="compNode")return;let t=this.scene.comps.get(e.id);if(!t)return;let r=this.scene.getAttr(e,"resolution");Array.isArray(r)&&r.length>=2&&(t.width=Math.max(1,Math.round(Number(r[0])||t.width)),t.height=Math.max(1,Math.round(Number(r[1])||t.height)));let n=this.scene.getAttr(e,"fps");Number.isFinite(Number(n))&&Number(n)>0&&(t.fps=Number(n));let o=this.scene.getAttr(e,"backgroundColor");typeof o=="string"&&o&&(t.bgColor=o);let s=this.scene.getAttr(e,"endFrame");Number.isFinite(Number(s))&&(t.endFrame=Math.max(1,Math.round(Number(s))),e.outFrame=t.endFrame)}get(e,t){let r=this.#e(e);return this.scene.getAttr(r,String(t))}connect(e,t,r,n,o){let s=this.#e(e),c=this.#e(r);he(s.type,String(t))||this.scene.warn(`connect: unknown source attribute ${s.id}.${t}`),!W(c.type,String(n))&&!he(c.type,String(n))&&this.scene.warn(`connect: unknown target attribute ${c.id}.${n}`),this.scene.connect(s.id,String(t),c.id,String(n),o===!0)}parent(e,t){this.scene.parent(String(e),String(t))}unParent(e){this.scene.parent(String(e),null)}getParent(e){return this.#e(e).parentId}rename(e,t){this.#e(e).name=String(t)}duplicate(e,t){let r=this.#e(e),n=this.scene.createLayer(r.type,r.name);for(let[o,s]of r.attrs)n.attrs.set(o,s);for(let[o,s]of r.keyframes)n.keyframes.set(o,s.map(c=>({...c})));return n.inFrame=r.inFrame,n.outFrame=r.outFrame,n.id}deleteLayer(e){let t=this.#e(e);for(let r of this.scene.comps.values()){let n=r.layerIds.indexOf(t.id);n>=0&&r.layerIds.splice(n,1)}this.scene.layers.delete(t.id)}keyframe(e,t,r){return this.scene.keyframe(String(e),t,r??{})[0]??""}magicEasing(e,t,r,n,o){this.scene.magicEasing(String(e),String(t),r,n,o)}modifyKeyframe(e,t){let r=this.#e(e);for(let[n,o]of Object.entries(t??{})){let s=r.keyframes.get(n);s||Y(`modifyKeyframe: '${n}' is not animated on ${r.id}`);let c=Math.round(Number(o.frame)),a=s.find(l=>l.frame===c);a||Y(`modifyKeyframe: no keyframe at frame ${c} on ${r.id}.${n}`),"newFrame"in o&&o.newFrame!=null&&(a.frame=Math.round(Number(o.newFrame))),"newValue"in o&&o.newValue!=null&&(a.value=o.newValue),"type"in o&&o.type!=null&&(a.type=Number(o.type)),s.sort((l,m)=>l.frame-m.frame)}}modifyKeyframeTangent(e,t){let r=this.#e(e);for(let[n,o]of Object.entries(t??{})){let s=r.keyframes.get(n);s||Y(`modifyKeyframeTangent: '${n}' is not animated on ${r.id}`);let c=Math.round(Number(o.frame)),a=s.find(b=>b.frame===c);a||Y(`modifyKeyframeTangent: no keyframe at frame ${c} on ${r.id}.${n}`),a.type=0;let l=o.inHandle!==!1,m=o.outHandle!==!1;if(a.magicEase=void 0,"angle"in o&&o.angle!=null){let b=Number(o.angle);l&&(a.inAngle=b),m&&(a.outAngle=b)}if("weight"in o&&o.weight!=null){let b=Math.max(0,Number(o.weight));l&&(a.inWeight=b),m&&(a.outWeight=b)}if("angleLocked"in o&&(a.magicEase=void 0),"xValue"in o&&o.xValue!=null){let b=Math.abs(Number(o.xValue)-a.frame);l&&(a.inWeight=b),m&&(a.outWeight=b)}}}setKeyframeVelocity(e,t){let r=this.#e(e);for(let[n,o]of Object.entries(t??{})){let s=r.keyframes.get(n);s||Y(`setKeyframeVelocity: '${n}' is not animated on ${r.id}`);let c=Math.round(Number(o.frame)),a=s.find(l=>l.frame===c);a||Y(`setKeyframeVelocity: no keyframe at frame ${c} on ${r.id}.${n}`),a.velocity={...o}}}clearKeyframeVelocity(e,t){let r=this.#e(e);for(let[n,o]of Object.entries(t??{})){let s=r.keyframes.get(n);if(!s)continue;let c=s.find(a=>a.frame===Math.round(Number(o.frame)));c&&delete c.velocity}}deleteKeyframe(e,t,r){let o=this.#e(e).keyframes.get(String(t));if(!o)return;let s=Math.round(r),c=o.findIndex(a=>a.frame===s);c>=0&&o.splice(c,1)}deleteAnimation(e,t){this.#e(e).keyframes.delete(String(t))}getKeyframeTimes(e,t){return(this.#e(e).keyframes.get(String(t))??[]).map(n=>n.frame)}getKeyframeIdsForAttribute(e,t){let r=this.#e(e);return(r.keyframes.get(String(t))??[]).map(n=>`${r.id}:${t}:${n.frame}`)}getAnimatedAttributes(e){return[...this.#e(e).keyframes.keys()]}getAttributes(e){let t=this.#e(e),r=["name","id","position","position.x","position.y","scale","scale.x","scale.y","rotation","opacity","pivot","hidden"];return[...new Set([...r,...t.attrs.keys(),...t.keyframes.keys()])]}getAttributeDefinition(e,t){let r=this.#e(e);return W(r.type,String(t))?{name:String(t),type:"attribute"}:null}getSelection(e){return[...this.scene.selection]}select(e){this.scene.selection=e.map(String)}getActiveComp(){return this.scene.activeComp()?.id??""}setActiveComp(e){let t=this.scene.comps.get(String(e));t||Y(`setActiveComp: no comp '${e}'`),this.scene.activeCompId=t.id}createComp(e,t,r,n,o){return this.scene.createComp(e,t,r,n,o).id}getCompLayers(e,t){return this.scene.compLayers(e===!0,t?String(t):void 0)}getAllLayerTypes(e){return[...new Set([...this.scene.layers.values()].map(t=>t.type))]}getLayerType(e){return this.#e(e).type}getNiceName(e){let t=this.#e(e);return t.name&&t.name!==t.type?t.name:t.id}getFrame(){return this.scene.frame}setFrame(e){this.scene.frame=Math.round(Number(e))}getInFrame(e){return this.#e(e).inFrame}getOutFrame(e){return this.#e(e).outFrame}setInFrame(e,t){this.#e(e).inFrame=Math.round(Number(t))}setOutFrame(e,t){this.#e(e).outFrame=Math.round(Number(t))}offsetLayerTime(e,t){let r=this.#e(e);r.inFrame+=Math.round(t),r.outFrame+=Math.round(t)}getBoundingBox(e,t){let r=this.scene.boundingBox(String(e));return r?{x:r.x,y:r.y,width:r.width,height:r.height,centre:r.centre,world:t!==!1}:null}getSelectionBoundingBox(){let e=1/0,t=1/0,r=-1/0,n=-1/0;for(let o of this.scene.selection){let s=this.scene.boundingBox(o);s&&(e=Math.min(e,s.x),t=Math.min(t,s.y),r=Math.max(r,s.x+s.width),n=Math.max(n,s.y+s.height))}return e===1/0?null:{x:e,y:t,width:r-e,height:n-t}}getPivotPosition(e){let t=this.#e(e),r=this.scene.worldTransform(t.id);return{x:r.x,y:r.y}}centrePivot(e){this.#e(e).attrs.set("pivot",[0,0])}getInConnectedAttributes(e){return this.scene.inConnectedAttributes(String(e))}getInConnection(e,t){return this.scene.inConnection(String(e),String(t))[0]??""}getOutConnections(e,t){return this.scene.outConnections(String(e),String(t)).map(r=>`${r.dstId}.${r.dstAttr}`)}getOutConnectedAttributes(e){let t=String(e);return[...new Set(this.scene.connections.filter(r=>r.srcId===t).map(r=>r.srcAttr))]}reorder(e,t){let r=this.scene.activeComp(),n=this.#e(e);if(!r)return;let o=r.layerIds.indexOf(n.id),s=r.layerIds.indexOf(String(t));o<0||s<0||r.layerIds.splice(s,0,r.layerIds.splice(o,1)[0])}startUndoGroup(e){this.scene.startUndoGroup(String(e))}endUndoGroup(){this.scene.endUndoGroup()}renderPNGFrame(e,t=100){let r=this.scene.activeComp();r||Y("renderPNGFrame: no active comp");let n=Math.max(1,Math.min(400,Number(t)||100))/100,o=Math.max(1,Math.round(r.width*n)),s=Math.max(1,Math.round(r.height*n)),a=this.options.render?.(this.scene,r.id,this.scene.frame,o,s)?.rgba??Buffer.alloc(o*s*4);if(this.lastFrames.push({frame:this.scene.frame,width:o,height:s,rgba:a}),this.lastFrames.length>64&&this.lastFrames.shift(),e){let l=/\.[A-Za-z0-9]+$/.test(e)?e:`${e}.png`;q.mkdirSync(X.dirname(l),{recursive:!0}),q.writeFileSync(`${l}.rgba`,a),q.writeFileSync(l,`MOCK-PNG frame=${this.scene.frame} ${o}x${s}
`)}return!0}writeToFile(e,t,r){let n=this.#t(e);return q.mkdirSync(X.dirname(n),{recursive:!0}),q.writeFileSync(n,String(t)),!0}readFromFile(e){return q.readFileSync(this.#t(e),"utf8")}filePathExists(e){return q.existsSync(this.#t(e))}getFileSize(e){try{return q.statSync(this.#t(e)).size}catch{return 0}}makeFolder(e){return q.mkdirSync(this.#t(e),{recursive:!0}),!0}getFolderFromPath(e){return X.dirname(String(e))}getHomeFolder(){return this.options.homeFolder??X.join(Ie.tmpdir(),"stallion-mock-home")}getAppDataFolder(){return X.join(this.getHomeFolder(),"AppData")}getSceneFilePath(){return"mock://scene.cv"}getCavalryVersion(){return"2.8.0-mock"}sceneHasUnsavedChanges(){return!1}saveSceneAs(e){this.scene.warn(`saveSceneAs: mock scene saved to ${e} (no real file)`)}layerExists(e){return this.scene.layer(e)!==null}#e(e){let t=this.scene.layer(e);return t||Y(`no layer '${e}'`),t}#t(e){let t=X.resolve(String(e)),r=X.resolve(this.getHomeFolder()),n=X.resolve(Ie.tmpdir());return t.startsWith(r)||t.startsWith(n)?t:X.join(r,"files",t.replace(/^([A-Za-z]:)?[\\/]+/,""))}};var Ne={None:[0,0,1,1],SlowIn:[.42,0,1,1],SlowOut:[0,0,.58,1],SlowInSlowOut:[.42,0,.58,1],VerySlowIn:[.76,0,1,1],VerySlowOut:[0,0,.24,1],VerySlowInVerySlowOut:[.76,0,.24,1],SpringIn:[.64,0,.78,.4],SpringOut:[.22,1.4,.36,1],SpringInSpringOut:[.5,1.4,.5,.4],AnticipateIn:[.36,0,.66,-.56],OvershootOut:[.34,1.56,.64,1],AnticipateInOvershootOut:[.5,-.4,.5,1.4],BounceOut:[.34,1.56,.64,1]},Ze={QuarticIn:"SlowIn",QuarticOut:"SlowOut",QuarticInOut:"SlowInSlowOut",CubicIn:"SlowIn",CubicOut:"SlowOut",CubicInOut:"SlowInSlowOut",ExpoIn:"VerySlowIn",ExpoOut:"VerySlowOut",ExpoInOut:"VerySlowInVerySlowOut",BackIn:"AnticipateIn",BackOut:"OvershootOut",BackInOut:"AnticipateInOvershootOut",Linear:"None"};function et(i,e){let[t,r,n,o]=i,s=1-e;return 3*s*s*e*r+3*s*e*e*o+e*e*e}function tt(i,e){let[t,,r]=i,n=1-e;return 3*n*n*e*t+3*n*e*e*r+e*e*e}function rt(i,e){let t=Ze[i],r=Ne[t??i]??Ne.SlowInSlowOut,n=0,o=1,s=e;for(let c=0;c<24;c++)s=(n+o)/2,tt(r,s)<e?n=s:o=s;return et(r,s)}function pe(i,e,t){return i+(e-i)*t}function P(i){if(Array.isArray(i)&&i.length>=2)return[Number(i[0])||0,Number(i[1])||0];if(i&&typeof i=="object"){let e=i;if("x"in e&&"y"in e)return[Number(e.x)||0,Number(e.y)||0]}return null}function ge(i){let e=2166136261,t=461845907;for(let n=0;n<i.length;n++){let o=i.charCodeAt(n);e=Math.imul((e^o&255)>>>0,16777619)>>>0,t=Math.imul((t^o>>>8&255)>>>0,16777619)>>>0}let r=n=>{let o="";for(let s=28;s>=0;s-=4)o+=(n>>>s&15).toString(16);return o};return r(e)+r(t)}var ce=class i{comps=new Map;layers=new Map;connections=[];selection=[];activeCompId=null;frame=0;diagnostics=[];lastUndo=null;strictSchema;counters=new Map;undoDepth=0;undoCreated=[];compCounter=0;constructor(e={}){this.strictSchema=e.strictSchema!==!1}diag(e,t){this.diagnostics.push({level:e,text:t})}warn(e){this.diag("warn",e)}nextId(e){let t=(this.counters.get(e)??0)+1;return this.counters.set(e,t),`${e}#${t}`}ensureComp(){return this.activeCompId&&this.comps.has(this.activeCompId)?this.comps.get(this.activeCompId):this.createComp()}createComp(e=1920,t=1080,r=24,n=215,o="#000000"){this.compCounter+=1;let s={id:`compNode#${this.compCounter}`,name:`Comp ${this.compCounter}`,fps:r,width:Math.max(1,Math.round(e)),height:Math.max(1,Math.round(t)),startFrame:0,endFrame:Math.max(1,Math.round(n)),bgColor:o,layerIds:[]};return this.comps.set(s.id,s),this.layers.set(s.id,{id:s.id,type:"compNode",name:s.name,parentId:null,attrs:new Map,keyframes:new Map,deformerIds:[],inFrame:s.startFrame,outFrame:s.endFrame}),this.activeCompId||(this.activeCompId=s.id),s}activeComp(){return this.activeCompId?this.comps.get(this.activeCompId)??null:null}createLayer(e,t){let r=this.ensureComp();e in _e||this.warn(`create: unknown node type '${e}' \u2014 created as generic node`);let o={id:this.nextId(e),type:e,name:t??`${e}`,parentId:null,attrs:new Map,keyframes:new Map,deformerIds:[],inFrame:0,outFrame:r.endFrame};return this.layers.set(o.id,o),r.layerIds.push(o.id),this.undoDepth>0&&this.undoCreated.push(o.id),o}layer(e){return this.layers.get(String(e))??null}compLayers(e,t){let r=t?this.comps.get(t):this.activeComp();return r?r.layerIds.filter(n=>{let o=this.layers.get(n);return o?e?o.parentId===null:!0:!1}):[]}static attrKind(e,t){return se(e).attributes[t]??null}setAttr(e,t,r){if(!W(e.type,t)){let o=`set: unknown attribute path '${t}' on ${e.type}`;if(this.strictSchema)return this.warn(o+" (not applied)"),!1;this.warn(o+" (applied anyway)")}if(e.keyframes.has(t)&&e.keyframes.get(t).length>0)return this.keyframe(e.id,this.frame,{[t]:r}),!0;let n=/^(.*)\.(x|y)$/.exec(t);if(n){let o=n[1],s=P(e.attrs.get(o)??i.attrKind(e.type,o)?.default);if(s){let c=[s[0],s[1]];return c[n[2]==="x"?0:1]=Number(r)||0,e.attrs.set(o,c),!0}}return e.attrs.set(t,r),!0}getAttr(e,t){if(e.keyframes.has(t)&&e.keyframes.get(t).length>0)return this.evaluate(e,t,this.frame);let r=this.evaluateCompoundPoint(e,t);if(r)return r;if(e.attrs.has(t))return e.attrs.get(t);let n=/^(.*)\.(x|y)$/.exec(t);if(n){let s=this.getAttr(e,n[1]),c=P(s);if(c)return c[n[2]==="x"?0:1]}let o=i.attrKind(e.type,t);return o?o.default:void 0}evaluateCompoundPoint(e,t){if(!(e.keyframes.has(`${t}.x`)||e.keyframes.has(`${t}.y`)))return null;let n=i.attrKind(e.type,t),o=P(e.attrs.get(t)??n?.default)??[0,0],s=e.keyframes.get(`${t}.x`),c=e.keyframes.get(`${t}.y`),a=s&&s.length?this.evaluate(e,`${t}.x`,this.frame):o[0],l=c&&c.length?this.evaluate(e,`${t}.y`,this.frame):o[1];return[Number(a)||0,Number(l)||0]}evaluate(e,t,r){let n=e.keyframes.get(t);if(!n||n.length===0)return this.getStaticValue(e,t);let o=n;if(r<=o[0].frame)return o[0].value;if(r>=o[o.length-1].frame)return o[o.length-1].value;let s=0;for(let h=0;h<o.length-1;h++)if(r>=o[h].frame&&r<=o[h+1].frame){s=h;break}let c=o[s],a=o[s+1],l=c.value,m=a.value;if(typeof l!="number"||typeof m!="number"){let h=P(l),I=P(m);if(!h||!I)return r-c.frame<=a.frame-r?l:m;let L=a.frame-c.frame||1,$=(r-c.frame)/L,p=i.segmentWeight(c,a,$);return[pe(h[0],I[0],p),pe(h[1],I[1],p)]}let b=a.frame-c.frame||1,w=(r-c.frame)/b;return pe(l,m,i.segmentWeight(c,a,w))}static segmentWeight(e,t,r){if(e.type===2)return 0;if(e.type===1)return r;if(e.magicEase)return rt(e.magicEase,r);let n=Math.max(t.frame-e.frame,1e-6),o=Math.min(Math.max(e.outWeight??n/3,0),n),s=Math.min(Math.max(t.inWeight??n/3,0),n),c=Math.tan(((e.outAngle??0)%360+360)%360*(Math.PI/180)),a=Math.tan(((t.inAngle??0)%360+360)%360*(Math.PI/180)),l=0,m=0,b=o/n,w=c*o/n,h=1-s/n,I=1-a*s/n,L=1,$=1,p=0,u=1,d=r;for(let y=0;y<24;y++){d=(p+u)/2;let f=1-d;3*f*f*d*b+3*f*d*d*h+d*d*d<r?p=d:u=d}let g=1-d;return 3*g*g*d*w+3*g*d*d*I+d*d*d}getStaticValue(e,t){if(e.attrs.has(t))return e.attrs.get(t);let r=/^(.*)\.(x|y)$/.exec(t);if(r){let n=P(this.getStaticValue(e,r[1]));if(n)return n[r[2]==="x"?0:1]}return i.attrKind(e.type,t)?.default}keyframe(e,t,r){let n=this.layer(e);if(!n)return this.warn(`keyframe: no layer '${e}'`),[];let o=[];for(let[s,c]of Object.entries(r)){let a=n.keyframes.get(s)??[],l=Math.round(t),m=a.find(b=>b.frame===l);m?m.value=c:a.push({frame:l,value:c,type:1}),a.sort((b,w)=>b.frame-w.frame),n.keyframes.set(s,a),o.push(`${n.id}:${s}:${l}`)}return o}magicEasing(e,t,r,n,o){let s=this.layer(e);if(!s)return;let c=s.keyframes.get(t)??[],a=Math.round(r),l=c.find(m=>m.frame===a);if(!l){this.warn(`magicEasing: no keyframe at frame ${a} on ${s.id}.${t}`);return}l.magicEase=n,l.type=0}connect(e,t,r,n,o=!1){let s=this.layer(e),c=this.layer(r);if(!s||!c){this.warn(`connect: missing endpoint ${s?r:e}`);return}let a=this.connections.find(m=>m.dstId===c.id&&m.dstAttr===n);if(a&&!o){this.warn(`connect: ${c.id}.${n} already connected from ${a.srcId}.${a.srcAttr} (use force)`);return}a&&this.connections.splice(this.connections.indexOf(a),1),this.connections.push({srcId:s.id,srcAttr:t,dstId:c.id,dstAttr:n}),/^(deformers)\.?/.exec(n)&&!c.deformerIds.includes(s.id)&&c.deformerIds.push(s.id)}inConnectedAttributes(e){return[...new Set(this.connections.filter(t=>t.dstId===e).map(t=>t.dstAttr))]}inConnection(e,t){return this.connections.filter(r=>r.dstId===e&&r.dstAttr===t).map(r=>`${r.srcId}.${r.srcAttr}`)}outConnections(e,t){return this.connections.filter(r=>r.srcId===e&&r.srcAttr===t).map(r=>({dstId:r.dstId,dstAttr:r.dstAttr}))}parent(e,t){let r=this.layer(e);if(!r)return;if(t===null){r.parentId=null;return}let n=this.layer(t);if(!n){this.warn(`parent: no layer '${t}'`);return}e!==t&&(r.parentId=n.id)}worldTransform(e){let t=this.layer(e);if(!t)return{x:0,y:0,scaleX:1,scaleY:1,rotation:0};let r=P(this.getAttr(t,"position"))??[0,0],n=P(this.getAttr(t,"scale"))??[100,100],o=Number(this.getAttr(t,"rotation"))||0;if(!t.parentId)return{x:r[0],y:r[1],scaleX:n[0]/100,scaleY:n[1]/100,rotation:o};let s=this.worldTransform(t.parentId),c=s.rotation*Math.PI/180,a=Math.cos(c),l=Math.sin(c),m=r[0]*s.scaleX,b=r[1]*s.scaleY;return{x:s.x+m*a-b*l,y:s.y+m*l+b*a,scaleX:s.scaleX*(n[0]/100),scaleY:s.scaleY*(n[1]/100),rotation:s.rotation+o}}boundingBox(e){let t=this.layer(e);if(!t||!se(t.type).visual)return null;let n=P(this.getAttr(t,"generator.dimensions"))??this.visualSize(t),o=this.worldTransform(e),s=Math.abs(n[0]*o.scaleX),c=Math.abs(n[1]*o.scaleY),a=o.rotation*Math.PI/180,l=Math.abs(Math.cos(a)),m=Math.abs(Math.sin(a)),b=s*l+c*m,w=s*m+c*l,h=P(this.getAttr(t,"pivot"))??[0,0],I=o.x-h[0]*o.scaleX,L=o.y-h[1]*o.scaleY;return{x:I-b/2,y:L-w/2,width:b,height:w,centre:{x:I,y:L}}}visualSize(e){let t=P(this.getAttr(e,"textBoxSize"));if(e.type==="textShape"){let r=String(this.getAttr(e,"text")??""),n=Number(this.getAttr(e,"fontSize"))||24;return t&&t[0]>0&&t[1]>0?t:[Math.max(1,r.length)*n*.55,n*1.2]}return t&&t[0]>0&&t[1]>0?t:[100,100]}startUndoGroup(e){this.undoDepth+=1,this.undoDepth===1&&(this.undoCreated=[],this.lastUndo={name:e,createdLayerIds:[]})}endUndoGroup(){this.undoDepth!==0&&(this.undoDepth-=1,this.undoDepth===0&&this.lastUndo&&(this.lastUndo.createdLayerIds=[...this.undoCreated],this.undoCreated=[]))}facts(){let e=[];for(let r of this.comps.values())for(let n of r.layerIds){let o=this.layers.get(n);if(!o)continue;let s=0;for(let c of o.keyframes.values())s+=c.length;e.push({id:o.id,type:o.type,keyframes:s})}e.sort((r,n)=>r.id<n.id?-1:r.id>n.id?1:0);let t=this.connections.map(r=>`${r.dstId}<-${r.dstAttr}`).sort();return{layers:e,connections:t}}sceneStateHash(){let e=this.facts().layers.map(t=>`${t.id}:${t.type}@k=${t.keyframes}`);return ge(`nodes(${e.join(";")})conn(${this.facts().connections.join(";")})`)}};import nt from"node:zlib";function Ce(i){if(i&&typeof i=="object"){let t=i;return[Number(t.r)||0,Number(t.g)||0,Number(t.b)||0,t.a==null?255:Number(t.a)||255]}if(typeof i!="string")return[255,255,255,255];let e=i.replace("#","");return e.length===3?[parseInt(e[0]+e[0],16),parseInt(e[1]+e[1],16),parseInt(e[2]+e[2],16),255]:e.length>=6?[parseInt(e.slice(0,2),16)||0,parseInt(e.slice(2,4),16)||0,parseInt(e.slice(4,6),16)||0,e.length>=8&&parseInt(e.slice(6,8),16)||255]:[255,255,255,255]}function it(i,e,t){switch(i){case"multiply":return e*t/255;case"screen":return 255-(255-e)*(255-t)/255;case"add":case"linearDodge":return Math.min(255,e+t);default:return t}}function ot(i,e){let r=String(e.attrs.get("generator")??"rectangleShape").includes("ellipse")?"ellipse":"rect",n=i.getAttr(e,"generator.dimensions"),o=Array.isArray(n)?n:[100,100],s=i.worldTransform(e.id),c=i.getAttr(e,"pivot"),a=Array.isArray(c)?c:[0,0],l=i.getAttr(e,"position"),m=Array.isArray(l)?l:[0,0];return{kind:r,w:Math.max(1,Number(o[0])||100),h:Math.max(1,Number(o[1])||100),cx:Number(m[0])||0,cy:Number(m[1])||0,rotation:s.rotation,scaleX:s.scaleX,scaleY:s.scaleY,pivotX:Number(a[0])||0,pivotY:Number(a[1])||0}}function st(i,e){let t=String(i.getAttr(e,"text")??""),r=Number(i.getAttr(e,"fontSize"))||24,n=i.getAttr(e,"textBoxSize"),o=Array.isArray(n)&&Number(n[0])>0?n:[t.length*r*.55,r*1.2],s=i.worldTransform(e.id),c=i.getAttr(e,"pivot"),a=Array.isArray(c)?c:[0,0],l=i.getAttr(e,"position"),m=Array.isArray(l)?l:[0,0];return{kind:"rect",w:Math.max(1,Number(o[0])),h:Math.max(1,Number(o[1])),cx:Number(m[0])||0,cy:Number(m[1])||0,rotation:s.rotation,scaleX:s.scaleX,scaleY:s.scaleY,pivotX:Number(a[0])||0,pivotY:Number(a[1])||0}}function ye(i,e,t,r,n){let o=i.comps.get(e),s=Math.max(1,Math.round(r)),c=Math.max(1,Math.round(n)),a=Buffer.alloc(s*c*4),l=Ce(o?.bgColor??"#000000");for(let w=0;w<s*c;w++)a[w*4]=l[0],a[w*4+1]=l[1],a[w*4+2]=l[2],a[w*4+3]=255;if(!o)return{width:s,height:c,rgba:a};let m=s/o.width,b=1/m;for(let w of o.layerIds){let h=i.layers.get(w);if(!h||i.getAttr(h,"hidden")===!0)continue;let L=h.type==="textShape",$=h.type==="basicShape"||h.type==="editableShape"||h.type==="rectangleShape"||h.type==="ellipseShape";if(!L&&!$)continue;let p=L?st(i,h):ot(i,h);if(!p)continue;let u=Ce(i.getAttr(h,"material.materialColor")),d=Number(i.getAttr(h,"material.alpha")),g=Number(i.getAttr(h,"opacity")),x=Math.max(0,Math.min(1,(Number.isFinite(d)?d:1)*(Number.isFinite(g)?g:1)));if(x<=0)continue;let y=String(i.getAttr(h,"blendMode")??"normal"),f=p.w/2*p.scaleX,k=p.h/2*p.scaleY,v=-p.rotation*Math.PI/180,S=Math.cos(v),A=Math.sin(v),M=p.cx-(p.pivotX*p.scaleX*Math.cos(p.rotation*Math.PI/180)-p.pivotY*p.scaleY*Math.sin(p.rotation*Math.PI/180)),N=p.cy-(p.pivotX*p.scaleX*Math.sin(p.rotation*Math.PI/180)+p.pivotY*p.scaleY*Math.cos(p.rotation*Math.PI/180)),O=Math.abs(f*S)+Math.abs(k*A),D=Math.abs(f*A)+Math.abs(k*S),G=Math.max(0,Math.floor((M-O)*m+s/2)),R=Math.min(s-1,Math.ceil((M+O)*m+s/2)),F=Math.max(0,Math.floor(c/2-(N+D)*m)),V=Math.min(c-1,Math.ceil(c/2-(N-D)*m));for(let z=F;z<=V;z++)for(let J=G;J<=R;J++){let Ge=(J+.5-s/2)*b,Ve=(c/2-(z+.5))*b,ke=Ge-M,we=Ve-N,Se=ke*S-we*A,Ae=ke*A+we*S,de;if(p.kind==="ellipse"){let U=Se/Math.max(f,1e-6),ee=Ae/Math.max(k,1e-6);de=U*U+ee*ee<=1}else de=Math.abs(Se)<=f&&Math.abs(Ae)<=k;if(!de)continue;let ie=(z*s+J)*4,oe=x*255,Me=a[ie+3],fe=oe+Me/255*(255-oe);if(fe!==0){for(let U=0;U<3;U++){let ee=a[ie+U],Je=y==="normal"?u[U]:it(y,ee,u[U]);a[ie+U]=Math.round((Je*oe+ee*(Me/255)*(255-oe))/(fe||1))}a[ie+3]=Math.round(fe)}}}return{width:s,height:c,rgba:a}}var at=(()=>{let i=new Uint32Array(256);for(let e=0;e<256;e++){let t=e;for(let r=0;r<8;r++)t=t&1?3988292384^t>>>1:t>>>1;i[e]=t>>>0}return i})();function ct(i){let e=4294967295;for(let t=0;t<i.length;t++)e=at[(e^i[t])&255]^e>>>8;return(e^4294967295)>>>0}function be(i,e){let t=Buffer.alloc(4);t.writeUInt32BE(e.length,0);let r=Buffer.from(i,"ascii"),n=Buffer.alloc(4);return n.writeUInt32BE(ct(Buffer.concat([r,e])),0),Buffer.concat([t,r,e,n])}function te(i,e,t){let r=Buffer.from([137,80,78,71,13,10,26,10]),n=Buffer.alloc(13);n.writeUInt32BE(e,0),n.writeUInt32BE(t,4),n[8]=8,n[9]=6;let o=e*4,s=Buffer.alloc((o+1)*t);for(let a=0;a<t;a++)s[a*(o+1)]=0,i.copy(s,a*(o+1)+1,a*o,(a+1)*o);let c=nt.deflateSync(s,{level:6});return Buffer.concat([r,be("IHDR",n),be("IDAT",c),be("IEND",Buffer.alloc(0))])}var ve="state",Fe="layers",ue="snapshot",le="snapshot-batch",ut=["subMesh","align","duplicator","stagger","falloff","noise","noiseDeformer","oscillator","valueBehavior","javascriptDeformer","round","offsetPath","trimPath"];var lt=["position.x","position.y","scale.x","scale.y","rotation","opacity"],re={BAD_REQUEST:"STALLION_BAD_REQUEST",MISSING_SEQ:"STALLION_MISSING_SEQ",EXEC_FAILED:"STALLION_EXEC_FAILED",NO_COMP:"STALLION_NO_ACTIVE_COMP",NO_FRAME:"STALLION_NO_FRAME",BAD_LAYER:"STALLION_UNKNOWN_LAYER",RENDER_FAILED:"STALLION_RENDER_FAILED",UNAUTHORISED:"STALLION_UNAUTHORISED"};function ne(i,e,t,r={}){let n={ok:!1,kind:i,error:t,code:e};return r.seq!==void 0&&(n.seq=r.seq),r.mgCall&&(n.mgCall=r.mgCall),r.layerId&&(n.layerId=r.layerId),r.attrPath&&(n.attrPath=r.attrPath),r.stack&&(n.stack=String(r.stack).slice(0,2e3)),n}function Q(i,e,t,r){let n=Number(i);return Number.isFinite(n)?Math.min(r,Math.max(t,Math.round(n))):e}function Ee(i,e){let r=(Array.isArray(e.attrs)?e.attrs:[]).map(n=>typeof n=="string"?n.trim():"").filter(Boolean).slice(0,40);return{kind:i,seq:e.seq,compId:typeof e.compId=="string"?e.compId.trim():"",frame:Number.isFinite(Number(e.frame))?Q(e.frame,0,-1e9,1e9):null,restoreFrame:null,offset:Q(e.offset,0,0,1e9),limit:Q(e.limit,200,1,1e3),attrs:r.length?r:[...lt],includeAttributes:e.attributes===!0,budgetMs:Q(e.budgetMs,120,5,5e3)}}function Re(i,e){return((typeof i=="string"?i.trim():"")||e).replace(/[\\/:*?"<>|]/g,"_").slice(0,80)}function Be(i){let e=Number(i.frame??i.t);if(!Number.isFinite(e))return{error:"snapshot requires a numeric `frame` (or `t`).",code:re.NO_FRAME};let t=Number(i.scale??i.resolutionScale),r=Re(i.fileName,`snapshot-${String(Math.round(e)).padStart(6,"0")}`);return{job:{seq:i.seq,compId:typeof i.compId=="string"?i.compId.trim():"",frame:Q(e,0,-1e9,1e9),restoreFrame:null,scale:Number.isFinite(t)&&t>0?Q(t,100,1,400):100,outDir:typeof i.outDir=="string"?i.outDir.trim().replace(/\\/g,"/"):"",fileName:r}}}function Oe(i){let e=Array.isArray(i.frames)?i.frames:[],t=new Set,r=[];for(let c of e){let a=Math.round(Number(c));if(!(!Number.isFinite(a)||Math.abs(a)>1e9||t.has(a))&&(t.add(a),r.push(a),r.length>=64))break}if(!r.length)return{error:"snapshot-batch requires a non-empty numeric `frames` array (1..64).",code:re.NO_FRAME};r.sort((c,a)=>c-a);let n=Number(i.scale??i.resolutionScale),o=Array.isArray(i.layerIds)?i.layerIds.map(c=>typeof c=="string"?c.trim():"").filter(Boolean).slice(0,200):[],s=Array.isArray(i.attrs)?i.attrs.map(c=>typeof c=="string"?c.trim():"").filter(Boolean).slice(0,16):[];return{job:{seq:i.seq,compId:typeof i.compId=="string"?i.compId.trim():"",frames:r,restoreFrame:null,scale:Number.isFinite(n)&&n>0?Q(n,100,1,400):100,outDir:typeof i.outDir=="string"?i.outDir.trim().replace(/\\/g,"/"):"",fileName:Re(i.fileName,"snapshot-batch"),layerIds:o,attrs:s,includeHidden:i.includeHidden===!0}}}function Te(i){return`/* cavalry-mcp:atomic */ (function () {
var __rb = ${JSON.stringify(i)};
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
// A measured box is only useful to a calibration loop if the pivot and the
// centre are explicit. pivotX/Y are the pivot's offset *inside* the box, so a
// caller never has to guess whether the box or the pivot is top-left based.
var __pivotInBox = function (box, pivot) {
	if (!box || !pivot) return box;
	return {
		x: box.x, y: box.y, width: box.width, height: box.height,
		pivotX: __num(pivot.x, 0) - box.x,
		pivotY: __num(pivot.y, 0) - box.y,
		centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 }
	};
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

// One parent walk builds the child map and the deformer classification without
// a getChildren call per layer (not every 2.8 build exposes it, and the walk is
// already bounded by the readback limit).
var __deformerTypes = ${JSON.stringify(ut)};
var __deformerSet = {};
for (var d0 = 0; d0 < __deformerTypes.length; d0++) __deformerSet[__deformerTypes[d0]] = true;
var __deformerType = function (type) {
	var raw = String(type == null ? '' : type);
	if (__deformerSet[raw]) return true;
	var lower = raw.toLowerCase();
	for (var d1 = 0; d1 < __deformerTypes.length; d1++) {
		if (__deformerTypes[d1].toLowerCase() === lower) return true;
	}
	return lower.indexOf('deformer') >= 0;
};
var __children = {};
for (var c0 = 0; c0 < __ids.length; c0++) {
	var __childParent = __read(function () { return api.getParent(__ids[c0]); });
	if (__childParent) {
		if (!__children[__childParent]) __children[__childParent] = [];
		__children[__childParent].push(__ids[c0]);
	}
}

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
		parent: parent || null,
		parentName: parent ? (__names[parent] || null) : null,
		hidden: false,
		visible: true,
		inFrame: __read(function () { return api.getInFrame(id); }),
		outFrame: __read(function () { return api.getOutFrame(id); }),
		boundingBox: null,
		worldBoundingBox: null,
		compBoundingBox: null,
		pivot: null,
		deformers: [],
		childCount: __children[id] ? __children[id].length : 0,
		attrs: {},
		connected: [],
		unreadable: []
	};
	var hidden = __read(function () { return api.get(id, 'hidden'); });
	entry.hidden = hidden === true || hidden === 1 || hidden === 'true';
	entry.visible = !entry.hidden;
	if (entry.visible) {
		// A layer outside its in/out range is not visible at this frame even when
		// the hidden flag is false. Report that as visibility, not as a box of 0.
		var __if = entry.inFrame, __of = entry.outFrame;
		if (typeof __if === 'number' && typeof __of === 'number' && (__frame < __if || __frame > __of)) entry.visible = false;
	}
	var pv = __read(function () { return api.getPivotPosition(id); });
	if (pv) entry.pivot = { x: __num(Array.isArray(pv) ? pv[0] : pv.x, 0), y: __num(Array.isArray(pv) ? pv[1] : pv.y, 0) };
	var worldBox = __pivotInBox(__box(__read(function () { return api.getBoundingBox(id, true); })), entry.pivot);
	var compBox = __pivotInBox(__box(__read(function () { return api.getBoundingBox(id, false); })), entry.pivot);
	if (worldBox) entry.worldBoundingBox = worldBox;
	if (compBox) entry.compBoundingBox = compBox;
	// The legacy boundingBox field keeps its historical meaning (world space) so
	// existing callers do not change behaviour; the two explicit fields are the
	// new contract for calibration and perceptual diffing.
	if (worldBox) entry.boundingBox = worldBox;
	else if (compBox) entry.boundingBox = compBox;
	var kids = __children[id] || [];
	for (var kd = 0; kd < kids.length && entry.deformers.length < 16; kd++) {
		var kidType = __read(function () { return api.getLayerType(kids[kd]); });
		if (!__deformerType(kidType)) continue;
		entry.deformers.push({
			id: kids[kd],
			type: kidType,
			name: __read(function () { return api.getNiceName(kids[kd]); }),
			visible: __read(function () { var h = api.get(kids[kd], 'hidden'); return !(h === true || h === 1 || h === 'true'); }) !== false
		});
	}

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
})()`}function Le(i){return`/* cavalry-mcp:atomic */ (function () {
var __sn = ${JSON.stringify(i)};
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
})()`}function De(i){return`/* cavalry-mcp:atomic */ (function () {
var __sb = ${JSON.stringify(i)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; }; };
var __num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
var __pad = function (n) { var s = String(n); while (s.length < 6) { s = '0' + s; } return s; };
var __box = function (bb) {
	if (!bb || typeof bb !== 'object') return null;
	var arr = Array.isArray(bb);
	var w = arr ? bb[2] : (bb.width === undefined ? bb.w : bb.width);
	var h = arr ? bb[3] : (bb.height === undefined ? bb.h : bb.height);
	return { x: __num(arr ? bb[0] : bb.x, 0), y: __num(arr ? bb[1] : bb.y, 0), width: __num(w, 0), height: __num(h, 0) };
};
var __dig = function (str) {
	var hi = 0x811c9dc5, lo = 0x1b873593;
	for (var p = 0; p < str.length; p++) {
		hi ^= str.charCodeAt(p); hi = Math.imul(hi, 0x01000193) >>> 0;
		lo ^= str.charCodeAt(str.length - 1 - p); lo = Math.imul(lo, 0x01000193) >>> 0;
	}
	return ('00000000' + hi.toString(16)).slice(-8) + ('00000000' + lo.toString(16)).slice(-8);
};
var __prevComp = __read(function () { return api.getActiveComp(); });
var __prevFrame = __num(__read(function () { return api.getFrame(); }), 0);
if (__sb.compId && __sb.compId !== __prevComp) { __read(function () { api.setActiveComp(__sb.compId); }); }
var __compId = __sb.compId || __prevComp;
if (!__compId) {
	return { ok: false, kind: 'snapshot-batch', seq: __sb.seq, error: 'No active comp to render.', code: 'STALLION_NO_ACTIVE_COMP', frames: [] };
}
var __dir = __sb.outDir || (api.getHomeFolder() + '/.stallion/snapshots');
var __all = __read(function () { return api.getCompLayers(false); }) || [];
var __index = {};
for (var ai = 0; ai < __all.length; ai++) __index[__all[ai]] = ai;
var __ids = __sb.layerIds && __sb.layerIds.length ? __sb.layerIds : (__read(function () { return api.getCompLayers(false); }) || []).slice(0, 200);
var __started = Date.now();
var __frames = [];
var __errors = [];
for (var f = 0; f < __sb.frames.length; f++) {
	var __frame = __sb.frames[f];
	var __stem = __dir + '/' + __sb.fileName + '-' + __pad(__frame);
	var __file = __stem + '.png';
	var __entry = { frame: __frame, file: __file, exists: false, sizeBytes: null, renderedAt: null, frameHash: null, layers: [], error: null, code: null };
	__read(function () { api.setFrame(__frame); });
	try {
		api.renderPNGFrame(__stem, __sb.scale);
		__entry.renderedAt = Date.now();
	} catch (e) {
		__entry.error = String(e && e.message ? e.message : e);
		__entry.code = 'STALLION_RENDER_FAILED';
	}
	var __bytes = __read(function () { return api.getFileSize(__file); });
	__entry.sizeBytes = __bytes === null ? null : Number(__bytes);
	__entry.exists = __bytes === null ? __read(function () { return api.filePathExists(__file); }) === true : Number(__bytes) > 0;
	if (!__entry.error && !__entry.exists) {
		__entry.error = 'renderPNGFrame produced no readable file at ' + __file;
		__entry.code = 'STALLION_RENDER_FAILED';
	}
	var __sig = '';
	for (var l = 0; l < __ids.length; l++) {
		var __id = __ids[l];
		var __pivot = __read(function () { return api.getPivotPosition(__id); });
		var __p = __pivot ? { x: __num(Array.isArray(__pivot) ? __pivot[0] : __pivot.x, 0), y: __num(Array.isArray(__pivot) ? __pivot[1] : __pivot.y, 0) } : null;
		var __world = __box(__read(function () { return api.getBoundingBox(__id, true); }));
		var __hidden = __read(function () { return api.get(__id, 'hidden'); });
		var __visible = !(__hidden === true || __hidden === 1 || __hidden === 'true');
		if (__visible) {
			var __in = __read(function () { return api.getInFrame(__id); });
			var __out = __read(function () { return api.getOutFrame(__id); });
			if (typeof __in === 'number' && typeof __out === 'number' && (__frame < __in || __frame > __out)) __visible = false;
		}
		var __bbox = null;
		if (__world) {
			__bbox = {
				x: __world.x, y: __world.y, width: __world.width, height: __world.height,
				pivotX: __p ? __p.x - __world.x : __world.width / 2,
				pivotY: __p ? __p.y - __world.y : __world.height / 2,
				centre: { x: __world.x + __world.width / 2, y: __world.y + __world.height / 2 }
			};
		}
		var __layer = {
			id: __id,
			ref: __read(function () { return api.getLayerType(__id); }) + '#' + (__index[__id] === undefined ? '?' : __index[__id]),
			type: __read(function () { return api.getLayerType(__id); }),
			name: __read(function () { return api.getNiceName(__id); }),
			visible: __visible,
			bbox: __bbox
		};
		if (__sb.attrs && __sb.attrs.length) {
			var __attrs = {};
			for (var a = 0; a < __sb.attrs.length; a++) {
				var __v = __read(function () { return api.get(__id, __sb.attrs[a]); });
				if (__v !== undefined && __v !== null) __attrs[__sb.attrs[a]] = __v;
			}
			__layer.attrs = __attrs;
		}
		if (!__sb.includeHidden && !__visible) continue;
		__sig += __id + '|' + (__bbox ? [__bbox.x, __bbox.y, __bbox.width, __bbox.height].join(',') : '') + ';';
		__entry.layers.push(__layer);
	}
	__entry.frameHash = __dig(String(__frame) + '#' + String(__compId) + '#' + __sig);
	__frames.push(__entry);
	if (__entry.error) __errors.push({ frame: __frame, error: __entry.error, code: __entry.code });
}
if (__sb.frames.length) __read(function () { api.setFrame(__prevFrame); });
if (__sb.compId && __prevComp && __sb.compId !== __prevComp) { __read(function () { api.setActiveComp(__prevComp); }); }
return {
	ok: __errors.length === 0,
	kind: 'snapshot-batch',
	seq: __sb.seq,
	compId: String(__compId),
	frames: __frames,
	errors: __errors,
	requested: __sb.frames.length,
	rendered: __frames.length - __errors.length,
	scale: __sb.scale,
	restoredFrame: __prevFrame,
	elapsedMs: Date.now() - __started
};
})()`}var Ue="0.10.0",K="__stallion_result__",mt="render-frames",_t=32*1024*1024,ht=64;function pt(i,e){let t=i.searchParams,r=(...a)=>{for(let l of a){let m=t.get(l);if(m!==null)return m}return null},n={type:e,seq:r("seq")??`get-${e}-${Date.now()}`},o=r("frame","t");if(o!==null&&(n.frame=o),e==="snapshot"||e==="snapshot-batch"){let a=r("scale","resolutionScale");a!==null&&(n.scale=a);let l=r("outDir","out");l!==null&&(n.outDir=l);let m=r("fileName","name");if(m!==null&&(n.fileName=m),e==="snapshot-batch"){let b=r("frames");b!==null&&(n.frames=b.split(",").map(I=>I.trim()).filter(Boolean));let w=r("layerIds");w!==null&&(n.layerIds=w.split(",").map(I=>I.trim()).filter(Boolean));let h=r("attrs");h!==null&&(n.attrs=h.split(",").map(I=>I.trim()).filter(Boolean)),/^(1|true|yes)$/i.test(r("includeHidden")??"")&&(n.includeHidden=!0)}}else{let a=r("offset");a!==null&&(n.offset=a);let l=r("limit");l!==null&&(n.limit=l);let m=r("budgetMs","budget");m!==null&&(n.budgetMs=m);let b=r("attrs","attributes");b!==null&&(/^(1|true|yes)$/i.test(b)?n.attributes=!0:n.attrs=b.split(",").map(w=>w.trim()).filter(Boolean))}let s=r("comp","compId");s!==null&&(n.compId=s);let c=r("mgCall");return c!==null&&(n.mgCall=c),n}function $e(i,e){let t=i.inline??e.searchParams.get("inline")??"1";return t!==!1&&!/^(0|false)$/i.test(String(t))}function gt(i,e){return e?(i.headers.authorization??"")===`Bearer ${e}`:!0}function He(i){return new Promise((e,t)=>{let r=[],n=0;i.on("data",o=>{if(n+=o.length,n>_t){t(new Error("request body too large")),i.destroy();return}r.push(o)}),i.on("end",()=>e(Buffer.concat(r).toString("utf8"))),i.on("error",t)})}function Ye(i,e,t={}){let r=[],n={log:(...p)=>r.push({level:"log",text:p.map(String).join(" ")}),info:(...p)=>r.push({level:"info",text:p.map(String).join(" ")}),warn:(...p)=>r.push({level:"warn",text:p.map(String).join(" ")}),error:(...p)=>r.push({level:"error",text:p.map(String).join(" ")})},s=i.startsWith("/* cavalry-mcp:atomic */")?i:`(function () {
		if (typeof api.startUndoGroup === 'function') api.startUndoGroup('AI Motion Batch');
		try {
			return (function () { ${i}
})();
		} finally {
			if (typeof api.endUndoGroup === 'function') api.endUndoGroup();
		}
	})()`,c=new Set(e.scene.layers.keys()),a={api:e,console:n,__result:void 0,__stallionState:void 0,cavalry:{versionLessThan:()=>!1,Path:class{d="";setD(p){return this.d=String(p),this}}}},l,m=null,b=null;try{l=ft.runInNewContext(`var __returned = (${s}); typeof __result === 'undefined' ? __returned : __result`,a,{timeout:3e4})}catch(p){let u=p;m=String(u?.message??u),b=u?.stack??null}if(t.verbose&&r.length)for(let p of r)process.stderr.write(`[mock:${p.level}] ${p.text}
`);let w=[...e.scene.layers.keys()].filter(p=>!c.has(p)),h=e.scene.activeComp(),I={},L=[...new Set([...w,...e.scene.selection])].slice(0,50);for(let p of L){let u=e.scene.boundingBox(p);u&&(I[p]={x:u.x,y:u.y,width:u.width,height:u.height,centre:u.centre})}let $={seq:null,status:m?"error":"ok",errorStack:b,createdLayerIds:w,activeSelection:[...e.scene.selection],compInfo:h?{id:h.id,name:h.name,fps:h.fps,startFrame:h.startFrame,endFrame:h.endFrame,resolution:[h.width,h.height],width:h.width,height:h.height}:null,boundingBoxes:I,durationMs:0,writtenAt:new Date().toISOString()};return e.scene.diagnostics.length&&($.diagnostics=e.scene.diagnostics.slice()),{result:l,error:m,stack:b,console:r,state:$}}function ze(i,e,t,r){let n={},o=r.slice(0,32);if(o.length){let l=i.frame;try{for(let m of o){i.frame=m;let b={};for(let w of t.slice(0,50)){let h=i.boundingBox(w),I=i.layer(w)&&Number(i.getAttr(i.layer(w),"rotation"))||0;h&&(b[w]={x:h.x,y:h.y,width:h.width,height:h.height,pivotX:h.centre.x,pivotY:h.centre.y,rotation:I})}n[String(m)]=b}}finally{i.frame=l}}let s=i.facts(),c=s.layers.map(l=>`${l.id}:${l.type}@k=${l.keyframes}`),a=e.slice(0,64).map(l=>({level:l.level,text:l.text.slice(0,240)}));for(let l of i.diagnostics){if(a.length>=64)break;a.push({level:l.level,text:l.text.slice(0,240)})}return{sceneStateHash:ge(`nodes(${c.join(";")})conn(${s.connections.join(";")})`),consoleDiagnostics:a,beatBBoxes:n}}function qe(i={}){let e=i.host??process.env.STALLION_HOST??"127.0.0.1",t=i.port??(Number(process.env.STALLION_PORT)||8080),r=i.token??process.env.STALLION_TOKEN??"",n=new ce({strictSchema:i.strictSchema!==!1}),o=new ae(n,{render:(u,d,g,x,y)=>ye(u,d,g,x,y)}),s=null,c=Promise.resolve(),a=()=>({kind:"status",stallion:`${Ue}-mock`,cavalry:"2.8.0-mock",scene:"mock://scene.cv",frame:n.frame,unSaved:!1,capabilities:{receipt:!0,renderFrames:!0,introspect:["state","layers","snapshot","snapshot-batch"],errorEnvelope:1,mock:!0},ts:Date.now()}),l=(u,d,g=200)=>{let x=JSON.stringify(d);u.writeHead(g,{"Content-Type":"application/json","Content-Length":Buffer.byteLength(x)}),u.end(x)},m=async u=>{let d=u.seq,x=(Array.isArray(u.frames)?u.frames:[]).map(R=>Math.round(Number(R))).filter(R=>Number.isFinite(R));if(!x.length||x.length>2e3)return{type:K,kind:"render-frames",seq:d,ok:!1,error:"render-frames requires 1..2000 frames"};let y=Number(u.resolutionScale),f=Number.isFinite(y)&&y>0?Math.min(4,Math.max(.01,y)):.5,k=u.format==="raw_rgba"?"raw_rgba":"png_buffer",v=typeof u.compId=="string"&&u.compId?u.compId:o.getActiveComp(),S=n.comps.get(v);if(!S)return{type:K,kind:"render-frames",seq:d,ok:!1,error:`no comp '${v}'`};let A=Math.max(1,Math.round(S.width*f)),M=Math.max(1,Math.round(S.height*f)),N=typeof u.outDir=="string"&&u.outDir.trim()?xe.resolve(u.outDir.trim()):null,O=n.frame,D=[],G=[];try{for(let R of x)try{n.frame=R;let F=ye(n,v,R,A,M),V={frame:R,width:F.width,height:F.height};if(D.length<ht){let z=te(F.rgba,F.width,F.height);V.bytes=k==="raw_rgba"?F.rgba.length:z.length,V.bufferBase64=(k==="raw_rgba"?F.rgba:z).toString("base64")}else V.omitted="inline budget exhausted; raise outDir to write files instead";if(N){T.mkdirSync(N,{recursive:!0});let z=String(R).padStart(6,"0"),J=xe.join(N,`frame-${z}.png`);T.writeFileSync(J,te(F.rgba,F.width,F.height)),V.file=J}D.push(V)}catch(F){G.push({frame:R,error:String(F?.message??F)})}}finally{n.frame=O}return{type:K,kind:"render-frames",seq:d,ok:D.length>0,format:k,scale:f,scalePercent:Math.round(f*100),compId:v,width:A,height:M,rendered:D,failed:G,receipt:ze(n,[],[],[])}},b=(u,d,g)=>{let x=g.seq??null,y=Ye(u,o,{verbose:i.verbose});if(y.error!==null)return{...ne(d,re.EXEC_FAILED,y.error,{seq:x,stack:y.stack??void 0})};let f=typeof y.result=="object"&&y.result!==null?y.result:{};return{type:K,kind:d,seq:x,...f,ok:f.ok!==!1}},w=(u,d)=>{let g=Ee(u,d);return b(Te(g),u,d)},h=u=>{let d=u.seq??null,g=Be(u);if("error"in g)return ne(ue,g.code,g.error,{seq:d,mgCall:typeof u.mgCall=="string"?u.mgCall:void 0});let x=b(Le(g.job),ue,u);if(x.ok===!0&&typeof x.file=="string"&&T.existsSync(x.file))try{x.contentHash=Pe("sha256").update(T.readFileSync(x.file)).digest("hex")}catch{}return x},I=u=>{let d=u.seq??null,g=Oe(u);if("error"in g)return ne(le,g.code,g.error,{seq:d,mgCall:typeof u.mgCall=="string"?u.mgCall:void 0});let x=b(De(g.job),le,u),y=Array.isArray(x.frames)?x.frames:[];for(let f of y){let k=typeof f.file=="string"?f.file:"";if(!(!k||!T.existsSync(k)))try{f.contentHash=Pe("sha256").update(T.readFileSync(k)).digest("hex")}catch{}}return x},L=u=>{let d=u.seq??null,g=typeof u.code=="string"?u.code:"",x=typeof u.statePath=="string"&&u.statePath?u.statePath:null,y=typeof u.path=="string"&&u.path;if(y&&!g){let M=T.existsSync(y);return{type:K,kind:"result",seq:d,ok:M,...M?{note:"file script executed (no captured result)"}:{error:`No script found at ${y}`}}}if(!g)return{type:K,kind:"result",seq:d,ok:!1,error:"Missing/empty `code` or `path` key in request"};let f=Array.isArray(u.beatFrames)?u.beatFrames.map(M=>Math.round(Number(M))).filter(M=>Number.isFinite(M)):[],k=Ye(g,o,{verbose:i.verbose}),v=[...new Set([...k.state.createdLayerIds??[],...k.state.activeSelection??[]])],S=ze(n,k.console,v,f);if(x)try{T.mkdirSync(xe.dirname(x),{recursive:!0}),T.writeFileSync(x,JSON.stringify({...k.state,seq:d,receipt:S}))}catch{}let A={type:K,kind:"result",seq:d,ok:k.error===null};return k.error!==null?(A.error=k.error,A.stack=k.stack):typeof k.result<"u"&&(A.result=k.result),A.receipt=S,A.state={...k.state,seq:d,receipt:S},A},$=(u,d,g)=>{if(u.ok!==!0)return;let x=Array.isArray(u.frames)?u.frames:[],y=n.comps.get(String(u.compId??""))??n.activeComp(),f=Number(u.scale);if(!$e(d,g)||!y||!Number.isFinite(f)||f<=0)return;let k=Math.max(1,Math.round(y.width*(f/100))),v=Math.max(1,Math.round(y.height*(f/100)));for(let S of x.slice(0,16)){let A=typeof S.file=="string"?S.file:"",M=`${A}.rgba`;if(!A||!T.existsSync(M))continue;let N=T.readFileSync(M);N.length===k*v*4&&(S.pngBase64=te(N,k,v).toString("base64"),S.width=k,S.height=v)}},p=dt.createServer((u,d)=>{(async()=>{let g=new URL(u.url??"/","http://localhost");if(!gt(u,r)){l(d,{error:"unauthorized"},401);return}if(u.method==="GET"&&g.pathname==="/"){let y=`Stallion mock bridge \u2014 POST /post, GET /get, POST /render-frames, GET|POST /state, /layers, /frame, /snapshot, /snapshot-batch
`;d.writeHead(200,{"Content-Type":"text/plain","Content-Length":Buffer.byteLength(y)}),d.end(y);return}if(u.method==="GET"&&g.pathname==="/get"){l(d,s??a());return}let x=g.pathname==="/state"||g.pathname==="/layers"?g.pathname.slice(1):g.pathname==="/snapshot-batch"?"snapshot-batch":g.pathname==="/frame"||g.pathname==="/snapshot"?"snapshot":null;if(x&&(u.method==="GET"||u.method==="HEAD"||u.method==="POST")){let y=pt(g,x);if(u.method==="POST")try{let k=await He(u);k.trim()&&(y={...y,...JSON.parse(k)})}catch(k){let v=String(k?.message??k);if(/too large/i.test(v)){l(d,ne(x,re.BAD_REQUEST,v),413);return}}let f=x==="snapshot"?h(y):x==="snapshot-batch"?I(y):w(x,y);if(s=f,x==="snapshot-batch"&&$(f,y,g),x==="snapshot"&&f.ok===!0){let v=`${typeof f.file=="string"?f.file:""}.rgba`;if($e(y,g)&&T.existsSync(v)){let S=n.comps.get(String(f.compId??""))??n.activeComp(),A=Number(f.scale);if(S&&Number.isFinite(A)&&A>0){let M=Math.max(1,Math.round(S.width*(A/100))),N=Math.max(1,Math.round(S.height*(A/100))),O=T.readFileSync(v);O.length===M*N*4?(f.pngBase64=te(O,M,N).toString("base64"),f.width=M,f.height=N):f.inlineNote=`sidecar length ${O.length} does not match ${M}x${N}x4`}}}if(u.method==="HEAD"){d.writeHead(200,{"Content-Type":"application/json"}),d.end();return}l(d,f);return}if(u.method==="POST"&&(g.pathname==="/post"||g.pathname==="/render-frames")){let y;try{y=await He(u)}catch(v){l(d,{error:String(v?.message??v)},413);return}let f;try{f=JSON.parse(y)}catch{l(d,{error:"Failed to parse request as JSON"},400);return}if(g.pathname==="/render-frames"&&(u.headers.accept??"").includes("application/octet-stream")){let v=await m(f),S=Array.isArray(v.rendered)?v.rendered:[],A=Buffer.alloc(4);A.writeUInt32BE(S.length,0);let M=[A];for(let O of S){let D=Buffer.alloc(8);D.writeUInt32BE(Number(O.frame),0),D.writeUInt16BE(Number(O.width),4),D.writeUInt16BE(Number(O.height),6);let G=Buffer.from(String(O.bufferBase64??""),"base64"),R=Buffer.alloc(4);R.writeUInt32BE(G.length,0),M.push(D,R,G)}let N=Buffer.concat(M);d.writeHead(200,{"Content-Type":"application/octet-stream","Content-Length":N.length}),d.end(N);return}let k=c.then(async()=>{let v;return f.type===K?(s=f,v={ok:!0}):f.type===mt?(v=await m(f),s=v):f.type===ve||f.type===Fe?(v=w(f.type===ve?"state":"layers",f),s=v):f.type===ue?(v=h(f),s=v):f.type===le?(v=I(f),$(v,f,g),s=v):f.type==="script"||f.path?(v=L(f),s=v):(v={type:K,kind:"result",seq:f.seq??null,ok:!1,error:`Unexpected type '${String(f.type)}'`},s=v),v});try{await k,l(d,{ok:!0})}catch(v){l(d,{ok:!1,error:String(v?.message??v)},500)}return}l(d,{error:"not found"},404)})().catch(()=>{d.headersSent||l(d,{error:"internal error"},500)})});return new Promise((u,d)=>{p.once("error",d),p.listen(t,e,()=>{let g=p.address(),x=typeof g=="object"&&g?g.port:t;u({port:x,host:e,scene:n,api:o,lastFrames:()=>o.lastFrames.slice(),close:()=>new Promise(y=>{p.close(()=>y())})})})})}function Xe(i=process.argv){return i.includes("--mock")?!0:process.env.STALLION_MOCK==="1"}async function Ke(i=process.argv){let e=(n,o)=>{let s=i.indexOf(n);return s>=0&&i[s+1]?i[s+1]:o},t=await qe({host:e("--host"),port:e("--port")?Number(e("--port")):void 0,token:e("--token"),strictSchema:!i.includes("--lax"),verbose:i.includes("--verbose")});process.stdout.write(`Stallion mock bridge v${Ue} \u2014 listening on ${t.host}:${t.port} (in-memory Cavalry 2.8 scene)
`);let r=()=>{t.close().then(()=>process.exit(0))};process.on("SIGINT",r),process.on("SIGTERM",r)}var je=(()=>{try{return import.meta.url===bt(process.argv[1]??"").href}catch{return!1}})();je&&!Xe()&&(process.stdout.write(`Usage: node dist/stallion-mock.mjs --mock [--host 127.0.0.1] [--port 8080] [--token T] [--lax] [--verbose]
Boot conditions: --mock flag, or STALLION_MOCK=1 environment variable.
`),process.exit(0));je&&await Ke();export{Ke as bootMockFromArgv,Xe as shouldBootMock,qe as startMockServer};
