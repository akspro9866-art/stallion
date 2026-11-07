import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Exercise the actual production listener/dispatcher, not just its generator.
const bridge = fs.readFileSync(new URL('../../dist/Stallion.js', import.meta.url), 'utf8')
const request = (extra = {}) => ({
	type: 'batchEvalAndCapture', transactionId: 'tx-1', undoGroupName: 'Requested group',
	seq: 'seq-1', code: 'globalThis.__refcloneLayerMap.hero = api.create("basicShape");',
	sampleFrames: [0, 12], inspectLayerIds: ['hero'], ...extra,
})

function host(mode = 'shared', loopback = 'queued') {
	const state = { frame: 7, comp: 'comp-a', queue: [], posts: [], served: [], events: [], open: false, created: 0, files: new Set() }
	let callbacks, realm
	const server = {
		listen(h, p) { assert.equal(h, '127.0.0.1'); assert.equal(p, 8080) },
		setHighFrequency() {}, addCallbackObject(c) { callbacks = c },
		setResultForGet(s) { state.served.push(s) },
		getNextPost() { return state.queue.shift() ?? null }, postCount() { return state.queue.length },
	}
	const api = {
		WebServer: function () { return server },
		WebClient: function (origin) { return {
			post(route, body, contentType) {
				assert.equal(origin, 'http://127.0.0.1:8080')
				assert.equal(route, '/post'); assert.equal(contentType, 'application/json')
				state.posts.push(body)
				if (loopback === 'queued') state.queue.push({ result: body })
			},
		} },
		exec(id, code) {
			if (id.endsWith('mg-preload')) return true
			vm.runInContext(code, mode === 'shared' ? realm : vm.createContext({ api, console: quiet }), { timeout: 5000 })
			return true
		},
		getAppDataFolder() { return '' }, getCavalryVersion() { return 'test-host' },
		getSceneFilePath() { return 'test.cv' }, sceneHasUnsavedChanges() { return false },
		getActiveComp() { return state.comp },
		setActiveComp(c) { state.comp = c; state.frame = 0; state.events.push('comp:' + c) },
		getFrame() { return state.frame }, setFrame(f) { state.frame = f; state.events.push('frame:' + f) },
		get(id, attr) {
			return { resolution: [320, 180], fps: 24, startFrame: 0, endFrame: 96,
				position: { x: state.frame, y: 20 }, scale: [1, 2], rotation: 30, opacity: 80 }[attr]
		},
		getCompLayers() { return [] }, getSelection() { return [] },
		getBoundingBox(id, world) {
			assert.equal(world, true); assert.equal(state.open, false, 'geometry must evaluate after endUndoGroup')
			state.events.push('bbox:' + id)
			return { x: state.frame - 5, y: 10, width: 10, height: 20, centre: { x: state.frame, y: 20 } }
		},
		create() { state.created++; return 'basicShape#' + state.created },
		set() {}, connect() {},
		startUndoGroup(name) { assert.equal(state.open, false); state.open = true; state.events.push('start:' + name) },
		endUndoGroup() { assert.equal(state.open, true); state.open = false; state.events.push('end') },
		makeFolder(dir) { state.events.push('mkdir:' + dir); return true },
		renderPNGFrame(stem, scale) { assert.equal(state.open, false); state.events.push(['render', stem, scale]); state.files.add(stem + '.png') },
		filePathExists(file) { return state.files.has(file) }, getFileSize(file) { return state.files.has(file) ? 99 : 0 },
	}
	const quiet = { log() {}, info() {}, warn() {}, error() {} }
	const ui = { Label: class { setAlignment() {} }, VLayout: class { addStretch() {} add() {} }, setTitle() {}, add() {}, show() {} }
	realm = vm.createContext({ api, ui, cavalry: { versionLessThan() { return false } }, console: quiet })
	vm.runInContext(bridge, realm)
	return {
		api, state, realm,
		post(payload) { state.queue.push({ result: JSON.stringify(payload) }); callbacks.onPost(); return this.get() },
		get() { return JSON.parse(state.served.at(-1)) },
		deliver(body) { state.queue.push({ result: body }); callbacks.onPost(); return this.get() },
	}
}

for (const mode of ['shared', 'isolated']) {
	test(`${mode}: real dispatcher delivers canonical seq envelope after queued internal POST`, () => {
		const h = host(mode)
		const out = h.post(request())
		assert.equal(out.kind, 'batchEvalAndCapture'); assert.equal(out.seq, 'seq-1'); assert.equal(out.ok, true, JSON.stringify(out.error))
		assert.equal(out.transactionId, 'tx-1'); assert.equal(out.result, undefined)
		assert.deepEqual(out.compInfo, { width: 320, height: 180, fps: 24, startFrame: 0, endFrame: 96 })
		assert.deepEqual(out.layerMap, { hero: 'basicShape#1' })
		assert.deepEqual(out.frames['12'].layerMetrics.hero, {
			bbox: { x: 7, y: 10, width: 10, height: 20, centreX: 12, centreY: 20 },
			worldTransform: { posX: 12, posY: 20, scaleX: 1, scaleY: 2, rotation: 30, opacity: 80 },
		})
		assert.equal(out.transformSpace, 'local'); assert.match(out.transformNote, /world-space/)
		assert.ok(Number.isFinite(out.executionTimeMs) && out.executionTimeMs >= 0)
		assert.equal(h.state.frame, 7); assert.equal(h.state.comp, 'comp-a')
		assert.deepEqual(h.state.events.filter((e) => typeof e === 'string' && /^(start|end)/.test(e)), ['start:Requested group', 'end'])
		assert.deepEqual(JSON.parse(h.state.posts[0]).batchEvalAndCaptureResult, out)
		for (const raw of h.state.served.slice(1)) assert.deepEqual(JSON.parse(raw), out)
	})
	test(`${mode}: rotation vectors normalize to the z viewport spin`, () => {
		const h = host(mode)
		const get = h.api.get
		// Live Cavalry 2.8 returns {x,y,z} for rotation even on flat layers;
		// setting rotation 50 reads back {x:0,y:0,z:50}, so z is the 2D spin.
		h.api.get = (id, attr) => (attr === 'rotation' ? { x: 12, y: 45, z: 30 } : get(id, attr))
		const out = h.post(request())
		assert.equal(out.ok, true, JSON.stringify(out.error))
		assert.equal(out.frames['12'].layerMetrics.hero.worldTransform.rotation, 30)
	})
	test(`${mode}: delayed loopback agrees with stash/no stale result overwrite`, () => {
		const h = host(mode, 'delayed')
		const first = h.post(request({ seq: 42 }))
		if (mode === 'isolated') assert.equal(first.kind, 'status')
		const out = h.deliver(h.state.posts[0])
		assert.equal(out.ok, true); assert.equal(out.seq, 42)
		if (mode === 'shared') assert.deepEqual(first, out)
	})
	test(`${mode}: render uses an extensionless stem and exact percentage`, () => {
		const h = host(mode)
		const out = h.post(request({ renderConfig: { enabled: true, outputDir: 'C:/test/artifacts.png', scaleFactor: 0.375 } }))
		assert.equal(out.ok, true, JSON.stringify(out.error))
		assert.deepEqual(h.state.events.filter(Array.isArray), [
			['render', 'C:/test/artifacts.png/frame_0', 37.5], ['render', 'C:/test/artifacts.png/frame_12', 37.5],
		])
		assert.equal(out.frames['0'].renderedPngPath, 'C:/test/artifacts.png/frame_0.png')
		assert.equal(out.frames['0'].pngBase64, undefined)
	})
	test(`${mode}: existing output directory is reused when makeFolder is false or throws`, () => {
		for (const behaviour of ['false', 'throw']) {
			const h = host(mode)
			h.api.makeFolder = (dir) => {
				h.state.events.push('mkdir-existing:' + dir)
				if (behaviour === 'throw') throw new Error('folder already exists')
				return false
			}
			const out = h.post(request({ renderConfig: { enabled: true, outputDir: 'C:/test/existing', scaleFactor: 1 } }))
			assert.equal(out.ok, true, JSON.stringify(out.error))
			assert.equal(out.frames['0'].renderedPngPath, 'C:/test/existing/frame_0.png')
			assert.equal(out.frames['12'].renderedPngPath, 'C:/test/existing/frame_12.png')
			assert.ok(h.state.events.includes('mkdir-existing:C:/test/existing'))
		}
	})
}

const malformed = [
	['missing transaction', { transactionId: undefined }], ['empty undo name', { undoGroupName: '' }],
	['non-string code', { code: {} }], ['oversized code', { code: ' '.repeat(512001) }],
	['65 frames', { sampleFrames: Array(65).fill(0) }], ['coerced frames', { sampleFrames: ['0'] }],
	['fractional frame', { sampleFrames: [0.5] }], ['frame range', { sampleFrames: [1e10] }],
	['non-array frames', { sampleFrames: {} }], ['201 aliases', { inspectLayerIds: Array(201).fill('hero') }],
	['empty alias', { inspectLayerIds: [''] }], ['bad alias type', { inspectLayerIds: [null] }],
	['inspection without frames', { sampleFrames: [] }], ['bad rollback type', { rollbackOnError: 'true' }],
	['null render', { renderConfig: null }], ['missing render boolean', { renderConfig: { outputDir: 'x' } }],
	['no output directory', { renderConfig: { enabled: true, outputDir: '' } }],
	['bad scale', { renderConfig: { enabled: true, outputDir: 'x', scaleFactor: '0.5' } }],
	['zero scale', { renderConfig: { enabled: true, outputDir: 'x', scaleFactor: 0 } }],
	['oversized scale', { renderConfig: { enabled: true, outputDir: 'x', scaleFactor: 4.01 } }],
]
for (const [name, patch] of malformed) test(`dispatcher validates before mutation: ${name}`, () => {
	const h = host()
	const out = h.post(request(patch))
	assert.equal(out.ok, false); assert.equal(out.kind, 'batchEvalAndCapture'); assert.equal(out.seq, 'seq-1')
	assert.ok(out.error.message); assert.deepEqual(h.state.events, []); assert.equal(h.state.created, 0)
})

test('inclusive frame/ID/code limits are accepted, empty capture is allowed', () => {
	const h = host()
	const out = h.post(request({ sampleFrames: Array.from({ length: 64 }, (_, i) => i), inspectLayerIds: Array(200).fill('hero') }))
	assert.equal(out.ok, true); assert.equal(Object.keys(out.frames).length, 64)
	assert.equal(h.post(request({ code: ' '.repeat(512000), sampleFrames: [], inspectLayerIds: [] })).ok, true)
})

test('syntax errors and unsupported rollback reject before opening an undo group', () => {
	for (const patch of [{ code: 'var = ;' }, { rollbackOnError: true }]) {
		const h = host()
		const out = h.post(request(patch))
		assert.equal(out.ok, false); assert.equal(h.state.created, 0); assert.deepEqual(h.state.events, [])
		if (patch.rollbackOnError) assert.match(out.error.message, /Unsupported rollback.*api.undo/)
	}
})

test('failure restores original comp/frame, transient globals and api functions', () => {
	const h = host()
	const savedSet = h.api.set, savedConnect = h.api.connect
	h.realm.__refcloneLayerMap = { stale: 'old' }
	h.realm.__result = { old: true }
	h.realm.__stallionState = { seq: 'seq-1', status: 'old' }
	const out = h.post(request({ code: `
		if (Object.keys(globalThis.__refcloneLayerMap).length) throw new Error('stale map');
		if (globalThis.__result || globalThis.__stallionState) throw new Error('stale globals');
		const localOnly = 1; var alsoLocal = 2;
		globalThis.transient = localOnly + alsoLocal;
		api.set = function () {}; api.connect = function () {};
		api.setActiveComp('comp-b'); api.setFrame(23);
		throw Object.assign(new Error('failure cleanup'), { lineNumber: 9 });
	` }))
	assert.equal(out.ok, false); assert.equal(out.error.line, 9); assert.match(out.error.stack, /failure cleanup/)
	assert.equal(h.api.set, savedSet); assert.equal(h.api.connect, savedConnect)
	assert.equal(h.state.open, false); assert.equal(h.state.frame, 7); assert.equal(h.state.comp, 'comp-a')
	for (const key of ['transient', 'localOnly', 'alsoLocal']) assert.equal(h.realm[key], undefined)
	assert.deepEqual(h.realm.__refcloneLayerMap, { stale: 'old' }); assert.deepEqual(h.realm.__result, { old: true })
	assert.deepEqual(out.frames, {})
})

test('aliases resolve exclusively from the fresh map, even with reused seq', () => {
	const h = host()
	assert.equal(h.post(request()).ok, true)
	for (const patch of [{ code: '' }, { code: '', inspectLayerIds: ['basicShape#1'] }, { code: '', inspectLayerIds: ['toString'] }]) {
		const out = h.post(request(patch))
		assert.equal(out.ok, false); assert.match(out.error.message, /Missing inspection alias/)
	}
	const out = h.post(request({ code: 'globalThis.__refcloneLayerMap = JSON.parse(\'{"__proto__":"basicShape#1"}\');', inspectLayerIds: ['__proto__'] }))
	assert.equal(out.ok, true); assert.equal(Object.hasOwn(out.frames['0'].layerMetrics, '__proto__'), true)
})

for (const [name, code, message] of [
	['nested __result', '__result = {ok:true,result:{ok:false,error:{message:"nested failure"}}};', /nested failure/],
	['global result', 'globalThis.__result = {ok:false};', /__result.ok/],
	['return result', 'return {ok:false,error:"returned failure"};', /returned failure/],
	['cyclic result', '__result = {}; __result.self = __result;', /serialisable/],
	['invalid map', 'globalThis.__refcloneLayerMap.hero = {};', /Invalid layer ID/],
	['nested group', 'api.startUndoGroup("second group");', /single undo group/],
]) test(`batch failure: ${name}`, () => {
	const h = host()
	const out = h.post(request({ code }))
	assert.equal(out.ok, false); assert.match(out.error.message, message); assert.equal(h.state.open, false)
	assert.equal(h.state.events.filter((e) => e === 'end').length, 1)
})

for (const failure of ['bbox', 'transform', 'render throw', 'render false', 'render missing file']) test(`all-or-fail capture: ${failure}`, () => {
	const h = host()
	if (failure === 'bbox') h.api.getBoundingBox = () => null
	if (failure === 'transform') { const get = h.api.get; h.api.get = (id, attr) => attr === 'rotation' ? undefined : get(id, attr) }
	if (failure === 'render throw') h.api.renderPNGFrame = () => { throw new Error('render exploded') }
	if (failure === 'render false') h.api.renderPNGFrame = () => false
	if (failure === 'render missing file') h.api.renderPNGFrame = () => {}
	const out = h.post(request({ renderConfig: { enabled: true, outputDir: 'C:/test' } }))
	assert.equal(out.ok, false); assert.ok(out.error.message); assert.deepEqual(out.frames, {}); assert.equal(h.state.frame, 7)
})

test('available undo is invoked once after close, never substituted with a checkpoint', () => {
	for (const code of ['throw new Error("boom");', '__result={ok:false};']) {
		const h = host()
		h.api.undo = () => { assert.equal(h.state.open, false); h.state.events.push('undo'); h.state.comp = 'comp-b'; h.state.frame = 0 }
		const out = h.post(request({ code, rollbackOnError: true }))
		assert.equal(out.ok, false)
		assert.equal(h.state.events.filter((e) => e === 'undo').length, 1)
		assert.ok(h.state.events.indexOf('undo') > h.state.events.indexOf('end'))
		assert.equal(h.state.comp, 'comp-a'); assert.equal(h.state.frame, 7)
	}
	const h = host(); h.api.undo = () => assert.fail('success must not undo')
	assert.equal(h.post(request({ rollbackOnError: true })).ok, true)
})

test('failed exec cannot reuse a stash with the same or omitted seq', () => {
	for (const seq of ['seq-1', undefined]) {
		const h = host()
		assert.equal(h.post(request({ seq })).ok, true)
		h.api.exec = () => false
		const out = h.post(request({ seq, transactionId: 'next' }))
		assert.equal(out.ok, false); assert.equal(out.transactionId, 'next'); assert.equal(out.seq, seq ?? null)
	}
})

test('legacy telemetry with reused seq is cleared and probes are restored', () => {
	const h = host()
	const savedSet = h.api.set, savedConnect = h.api.connect
	h.realm.__stallionState = { seq: 'reuse', status: 'stale' }
	const out = h.post({ type: 'script', seq: 'reuse', diagnostics: true, code: '/* cavalry-mcp:atomic */ (function(){ __result=42; })()' })
	assert.equal(out.result, 42); assert.equal(out.state, undefined)
	assert.equal(h.api.set, savedSet); assert.equal(h.api.connect, savedConnect)
})
