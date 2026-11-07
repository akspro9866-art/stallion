// Checkpoint rollback contract: full-scene save/openScene isolation for hosts
// WITHOUT api.undo or undo grouping (the live Cavalry 2.8.0 shape). Exercises
// the real production dispatcher from dist/Stallion.js, never a reimplementation.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const bridge = fs.readFileSync(new URL('../../dist/Stallion.js', import.meta.url), 'utf8')
const CP = 'C:/test/checkpoints/tx-cp.cv'
const request = (extra = {}) => ({
	type: 'batchEvalAndCapture', transactionId: 'tx-cp', undoGroupName: 'Checkpoint group',
	seq: 'seq-cp', code: 'globalThis.__refcloneLayerMap.hero = api.create("basicShape");',
	sampleFrames: [0], inspectLayerIds: ['hero'],
	rollbackOnError: true, rollbackStrategy: 'checkpoint', checkpointPath: CP, ...extra,
})

function host(mode = 'shared', overrides = {}) {
	const state = {
		frame: 7, comp: 'comp-a', queue: [], posts: [], served: [], events: [],
		layers: [], scenePath: '', unsaved: false, files: new Map(), snapshots: new Map(),
		created: 0, saveReturns: true, saveWritesFile: true, openSceneFail: false, openSceneWrongPath: false,
		...overrides,
	}
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
				state.queue.push({ result: body })
			},
		} },
		exec(id, code) {
			if (id.endsWith('mg-preload')) return true
			vm.runInContext(code, mode === 'shared' ? realm : vm.createContext({ api, console: quiet }), { timeout: 5000 })
			return true
		},
		getAppDataFolder() { return '' }, getCavalryVersion() { return 'test-host' },
		getSceneFilePath() { return state.scenePath },
		sceneHasUnsavedChanges() { return state.unsaved },
		saveSceneAs(p) {
			state.events.push('save:' + p)
			if (!state.saveReturns || state.files.has(p)) return false
			const snapshot = { layers: [...state.layers], comp: state.comp, frame: state.frame }
			state.snapshots.set(p, snapshot)
			if (state.saveWritesFile) state.files.set(p, JSON.stringify(snapshot))
			state.scenePath = p
			state.unsaved = false
			return true
		},
		openScene(p, discard) {
			state.events.push('open:' + p + ':' + discard)
			if (state.openSceneFail) return false
			const snapshot = state.snapshots.get(p)
			if (!snapshot) return false
			state.layers = [...snapshot.layers]; state.comp = snapshot.comp; state.frame = snapshot.frame
			state.scenePath = state.openSceneWrongPath ? 'C:/elsewhere.cv' : p
			state.unsaved = false
			return true
		},
		getActiveComp() { return state.comp },
		setActiveComp(c) { state.comp = c; state.frame = 0; state.events.push('comp:' + c) },
		getFrame() { return state.frame }, setFrame(f) { state.frame = f; state.events.push('frame:' + f) },
		get(id, attr) {
			return { resolution: [320, 180], fps: 24, startFrame: 0, endFrame: 96,
				position: { x: state.frame, y: 20 }, scale: [1, 1], rotation: 0, opacity: 100 }[attr]
		},
		getCompLayers() { return [...state.layers] }, getSelection() { return [] },
		getBoundingBox(id, world) {
			assert.equal(world, true)
			return { x: 0, y: 10, width: 10, height: 20, centre: { x: 5, y: 20 } }
		},
		create() { state.created++; state.unsaved = true; const id = 'basicShape#' + state.created; state.layers.push(id); return id },
		set() {}, connect() {},
		makeFolder(dir) { state.events.push('mkdir:' + dir); return true },
		renderPNGFrame(stem, scale) { state.events.push(['render', stem, scale]); state.files.set(stem + '.png', 'png') },
		filePathExists(file) { return state.files.has(file) }, getFileSize(file) { return state.files.has(file) ? 99 : 0 },
		// Deliberately NO undo/startUndoGroup/endUndoGroup: the live 2.8.0 shape.
	}
	const quiet = { log() {}, info() {}, warn() {}, error() {} }
	const ui = { Label: class { setAlignment() {} }, VLayout: class { addStretch() {} add() {} }, setTitle() {}, add() {}, show() {} }
	realm = vm.createContext({ api, ui, cavalry: { versionLessThan() { return false } }, console: quiet })
	vm.runInContext(bridge, realm)
	return {
		api, state, realm,
		post(payload) { state.queue.push({ result: JSON.stringify(payload) }); callbacks.onPost(); return this.get() },
		get() { return JSON.parse(state.served.at(-1)) },
	}
}

for (const mode of ['shared', 'isolated']) {
	test(`${mode}: checkpoint batch succeeds on a host without undo or grouping`, () => {
		const h = host(mode)
		const out = h.post(request())
		assert.equal(out.ok, true, JSON.stringify(out.error))
		assert.equal(out.kind, 'batchEvalAndCapture'); assert.equal(out.seq, 'seq-cp')
		assert.equal(out.rollbackStrategy, 'checkpoint')
		assert.deepEqual(out.checkpoint, {
			path: CP, saved: true, committed: true,
			commitPath: 'C:/test/checkpoints/tx-cp-committed.cv',
			originalScenePath: '', scenePathAfterSave: CP,
			scenePathAfterCommit: 'C:/test/checkpoints/tx-cp-committed.cv',
		})
		assert.deepEqual(out.layerMap, { hero: 'basicShape#1' })
		assert.ok(out.frames['0'].layerMetrics.hero)
		assert.deepEqual(h.state.events.filter((e) => typeof e === 'string' && /^(start|end)/.test(e)), [])
		assert.ok(h.state.events.includes('save:' + CP))
		assert.ok(h.state.events.includes('save:C:/test/checkpoints/tx-cp-committed.cv'))
		assert.equal(h.state.layers.length, 1, 'successful mutations persist')
		assert.equal(h.state.scenePath, 'C:/test/checkpoints/tx-cp-committed.cv')
		assert.equal(h.state.unsaved, false, 'the commit leaves the scene saved for the next transaction')
		assert.deepEqual(JSON.parse(h.state.posts[0]).batchEvalAndCaptureResult, out)
		for (const raw of h.state.served.slice(1)) assert.deepEqual(JSON.parse(raw), out)
	})

	test(`${mode}: failed batch restores the checkpoint and reports the restore path`, () => {
		const h = host(mode)
		const out = h.post(request({ code: `
			globalThis.__refcloneLayerMap.hero = api.create("basicShape");
			api.setActiveComp('comp-b'); api.setFrame(23);
			throw new Error('deliberate checkpoint failure');
		` }))
		assert.equal(out.ok, false)
		assert.match(out.error.message, /deliberate checkpoint failure/)
		assert.equal(out.checkpoint.saved, true)
		assert.equal(out.checkpoint.restored, true)
		assert.equal(out.checkpoint.scenePathAfterRestore, CP)
		assert.equal(out.checkpoint.sceneStateUnknown, undefined)
		assert.deepEqual(out.frames, {}); assert.equal(out.layerMap, undefined)
		assert.deepEqual(h.state.layers, [], 'created layer removed by restore')
		assert.equal(h.state.comp, 'comp-a'); assert.equal(h.state.frame, 7)
		assert.ok(h.state.events.includes('open:' + CP + ':true'))
		assert.equal(h.state.scenePath, CP)
	})

	test(`${mode}: empty capture with a checkpoint save is allowed (qualification noop)`, () => {
		const h = host(mode)
		const out = h.post(request({ code: ' ', sampleFrames: [], inspectLayerIds: [] }))
		assert.equal(out.ok, true, JSON.stringify(out.error))
		assert.deepEqual(out.frames, {})
		assert.equal(out.checkpoint.saved, true)
		assert.equal(out.checkpoint.committed, true)
		assert.equal(h.state.created, 0)
		assert.equal(h.state.unsaved, false)
	})

	test(`${mode}: a committed scene lets the next checkpoint batch pass the clean-scene gate`, () => {
		const h = host(mode)
		const first = h.post(request())
		assert.equal(first.ok, true, JSON.stringify(first.error))
		const second = h.post(request({
			transactionId: 'tx-cp-2', seq: 'seq-cp-2',
			checkpointPath: 'C:/test/checkpoints/tx-cp-2.cv',
		}))
		assert.equal(second.ok, true, JSON.stringify(second.error))
		assert.equal(second.checkpoint.saved, true)
		assert.equal(second.checkpoint.committed, true)
		assert.equal(h.state.layers.length, 2, 'the second checkpoint starts from the committed scene')
	})

	test(`${mode}: render still produces frame_<n>.png under checkpoint strategy`, () => {
		const h = host(mode)
		const out = h.post(request({ renderConfig: { enabled: true, outputDir: 'C:/test/artifacts', scaleFactor: 1 } }))
		assert.equal(out.ok, true, JSON.stringify(out.error))
		assert.equal(out.frames['0'].renderedPngPath, 'C:/test/artifacts/frame_0.png')
		assert.deepEqual(h.state.events.filter(Array.isArray), [['render', 'C:/test/artifacts/frame_0', 100]])
	})
}

test('a readback loopback is promoted to the canonical kind, not kind:"result"', () => {
	// Live hosts deliver a wrapped script on two channels. The readback reshape
	// serves kind:"state" first; the drained loopback must serve the same
	// canonical document instead of overwriting it with the raw wrapper.
	const h = host('shared')
	h.state.layers.push('basicShape#prior')
	h.post({ type: 'state', seq: 'read-1', includeAttributes: false })
	const served = h.state.served.map((raw) => JSON.parse(raw)).filter((doc) => doc.seq === 'read-1')
	assert.equal(served.length, 2, 'both channels serve a correlated envelope')
	assert.ok(served.every((doc) => doc.kind === 'state'), 'no channel may serve kind:"result"')
	const last = served.at(-1)
	assert.equal(last.result, undefined, 'the raw wrapper must not survive as a nested result')
	assert.equal(last.ok, true)
	assert.ok(Array.isArray(last.layers))
})

test('dirty scene rejects before any save or mutation', () => {
	const h = host('shared', { unsaved: true })
	const out = h.post(request())
	assert.equal(out.ok, false)
	assert.match(out.error.message, /clean scene/)
	assert.deepEqual(h.state.events, [])
	assert.equal(h.state.created, 0)
	assert.equal(h.state.files.size, 0)
	assert.equal(out.checkpoint.saved, false)
})

test('an existing checkpoint file is never overwritten', () => {
	const h = host()
	h.state.files.set(CP, 'previous')
	const out = h.post(request())
	assert.equal(out.ok, false)
	assert.match(out.error.message, /already exists/)
	assert.deepEqual(h.state.events, [])
	assert.equal(h.state.created, 0)
	assert.equal(h.state.files.get(CP), 'previous')
})

test('missing checkpoint APIs reject before mutation', () => {
	for (const key of ['saveSceneAs', 'openScene', 'getSceneFilePath', 'sceneHasUnsavedChanges']) {
		const h = host()
		delete h.api[key]
		const out = h.post(request())
		assert.equal(out.ok, false)
		assert.match(out.error.message, /Checkpoint rollback is unavailable/)
		assert.deepEqual(h.state.events, [])
		assert.equal(h.state.created, 0)
	}
})

test('unconfirmed or fileless checkpoint saves reject before mutation', () => {
	for (const [patch, message] of [[{ saveReturns: false }, /did not confirm/], [{ saveWritesFile: false }, /produced no file/]]) {
		const h = host('shared', patch)
		const out = h.post(request())
		assert.equal(out.ok, false)
		assert.match(out.error.message, message)
		assert.equal(h.state.created, 0)
		assert.equal(out.checkpoint.saved, false)
		assert.equal(out.checkpoint.restored, undefined, 'nothing was mutated; no restore attempted')
		assert.equal(h.state.events.filter((e) => e.startsWith('open:')).length, 0)
	}
})

test('a refused restore is reported as sceneStateUnknown, never hidden', () => {
	const h = host('shared', { openSceneFail: true })
	const out = h.post(request({ code: 'api.create("basicShape"); throw new Error("fail after mutation");' }))
	assert.equal(out.ok, false)
	assert.match(out.error.message, /openScene refused/)
	assert.equal(out.checkpoint.restored, false)
	assert.equal(out.checkpoint.sceneStateUnknown, true)
	assert.equal(h.state.layers.length, 1, 'the harness cannot restore; the envelope must say so')
})

test('a restore reporting a different scene path is sceneStateUnknown', () => {
	const h = host('shared', { openSceneWrongPath: true })
	const out = h.post(request({ code: 'api.create("basicShape"); throw new Error("fail after mutation");' }))
	assert.equal(out.ok, false)
	assert.match(out.error.message, /different scene path/)
	assert.equal(out.checkpoint.restored, false)
	assert.equal(out.checkpoint.sceneStateUnknown, true)
})

test('capture failure after a successful mutation also restores the checkpoint', () => {
	const h = host()
	h.api.getBoundingBox = () => null
	const out = h.post(request())
	assert.equal(out.ok, false)
	assert.match(out.error.message, /Missing bounding box/)
	assert.equal(out.checkpoint.restored, true)
	assert.deepEqual(h.state.layers, [])
	assert.deepEqual(out.frames, {})
})

const malformed = [
	['unknown strategy', { rollbackStrategy: 'magic' }],
	['checkpoint without rollback', { rollbackOnError: false }],
	['checkpoint without path', { checkpointPath: undefined }],
	['empty path', { checkpointPath: '' }],
	['non-cv path', { checkpointPath: 'C:/test/checkpoint.txt' }],
	['path with undo strategy', { rollbackStrategy: 'undo', checkpointPath: CP }],
	['path with default strategy', { rollbackStrategy: undefined, checkpointPath: CP }],
	['null path', { checkpointPath: null }],
]
for (const [name, patch] of malformed) test(`checkpoint validation rejects before mutation: ${name}`, () => {
	const h = host()
	const out = h.post(request(patch))
	assert.equal(out.ok, false)
	assert.equal(out.kind, 'batchEvalAndCapture')
	assert.ok(out.error.message)
	assert.deepEqual(h.state.events, [])
	assert.equal(h.state.created, 0)
})

test('backslash checkpoint paths normalize to scene URIs', () => {
	const h = host()
	const out = h.post(request({ checkpointPath: 'C:\\test\\checkpoints\\win.cv' }))
	assert.equal(out.ok, true, JSON.stringify(out.error))
	assert.equal(out.checkpoint.path, 'C:/test/checkpoints/win.cv')
	assert.ok(h.state.events.includes('save:C:/test/checkpoints/win.cv'))
})

test('the default undo strategy still rejects hosts without api.undo', () => {
	const h = host()
	const out = h.post(request({ rollbackStrategy: undefined, checkpointPath: undefined }))
	assert.equal(out.ok, false)
	assert.match(out.error.message, /Unsupported rollback.*api\.undo/)
	assert.deepEqual(h.state.events, [])
	assert.equal(h.state.created, 0)
})