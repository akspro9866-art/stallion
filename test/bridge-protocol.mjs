/**
 * Bridge protocol smoke test for dist/Stallion.js — no Cavalry required.
 *
 * Loads the compiled bridge into a sandbox with a mock `api`/`ui`/`cavalry`
 * and drives the v0.9 protocol:
 *
 *   1. status heartbeat served on GET /get at startup
 *   2. script results (seq-tagged, ok/result) via the globalThis stash
 *      (shared script context)
 *   3. script results via the loopback WebClient POST (isolated context)
 *   4. error capture from thrown scripts
 *   5. expression-type posts report applied/skipped lists
 *   6. stallion.json config: host/port/token honoured
 *
 * Run: node test/bridge-protocol.mjs   (exit 0 = all assertions passed)
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import os from 'node:os'
import assert from 'node:assert/strict'

const dist = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '../dist/Stallion.js')
const code = fs.readFileSync(dist, 'utf8')

function makeMockApi({ appDataFolder = null, execMode = 'shared' } = {}) {
  const state = {
    queue: [],
    served: null,
    listenArgs: null,
    tokenAuth: null,
    clientPosts: [],
    selected: ['basicShape#1'],
    undo: [],
  }
  let callbackObject = null
  const server = {
    listen(host, port) { state.listenArgs = { host, port } },
    setHighFrequency() {},
    addCallbackObject(cb) { callbackObject = cb },
    setResultForGet(text) { state.served = text },
    setTokenAuthentication(token) { state.tokenAuth = token },
    getNextPost() { return state.queue.shift() ?? null },
    postCount() { return state.queue.length },
  }
  const api = {
    WebServer: function () { return server },
    WebClient: function (origin) {
      return {
        setTokenAuthentication() {},
        post(_p, body, _ct) {
          state.clientPosts.push({ origin, body })
          state.queue.push({ result: body }) // loopback delivery
        },
      }
    },
    getAppDataFolder: () => appDataFolder,
    filePathExists: (p) => typeof p === 'string' && p.endsWith('stallion.json'),
    readFromFile: (p) => fs.readFileSync(p, 'utf8'),
    exec(scriptId, script) {
      state.lastScriptId = scriptId
      if (execMode === 'shared') {
        // shared context: the wrapper's globalThis IS Stallion's
        vm.runInContext(script, api.__realm)
      } else {
        // isolated context: only api is injected, globalThis is fresh
        const isolated = vm.createContext({ api, console })
        vm.runInContext(script, isolated)
      }
      return true
    },
    getCavalryVersion: () => '2.8.0-mock',
    getSceneFilePath: () => '/mock/scene.cv',
    getFrame: () => state.frame ?? 7,
    setFrame: (f) => { state.frame = f },
    sceneHasUnsavedChanges: () => false,
    getSelection: () => state.selected,
    getCompLayers: () => ['basicShape#1'],
    getAnimatedAttributes: () => ['position.x'],
    getKeyframeTimes: () => [0, 24],
    getInConnectedAttributes: () => ['deformers'],
    getBoundingBox: () => ({ x: 0, y: 0, width: 10, height: 20 }),
    getPivotPosition: () => ({ x: 5, y: 10 }),
    getLayerType: (id) => id.split('#')[0],
    getNiceName: (id) => `name of ${id}`,
    set: () => true,
    get: () => undefined,
    getRenderQueueItems: () => ['renderQueueItem#1'],
    create: (type) => `${type}#9`,
    startUndoGroup: (name) => state.undo.push(`start:${name}`),
    endUndoGroup: () => state.undo.push('end'),
  }
  const ui = {
    Label: class { setAlignment() {} },
    VLayout: class { addStretch() {} add() {} },
    setTitle() {},
    add() {},
    show() {},
  }
  const cavalry = { versionLessThan: () => false }
  const ctx = vm.createContext({ api, ui, cavalry, console })
  api.__realm = ctx // shared-context exec runs inside Stallion's own realm
  vm.runInContext(code, ctx)
  return { state, api, tick: () => callbackObject.onPost(), post: (payload) => state.queue.push({ result: JSON.stringify(payload) }) }
}

const served = (m) => JSON.parse(m.state.served)

// 1. status heartbeat at startup
{
  const m = makeMockApi()
  const s = served(m)
  assert.equal(s.kind, 'status')
  assert.equal(s.stallion, '0.10.0')
  assert.equal(s.cavalry, '2.8.0-mock')
  assert.equal(s.capabilities.receipt, true)
  assert.equal(s.capabilities.renderFrames, true)
  assert.deepEqual(m.state.listenArgs, { host: '127.0.0.1', port: 8080 })
  assert.equal(m.state.tokenAuth, null)
  console.log('✔ status heartbeat served at startup')
}

// 2. shared context: result via globalThis stash, served synchronously
{
  const m = makeMockApi({ execMode: 'shared' })
  m.post({ type: 'script', code: '__result = 40 + 2;', seq: 's1' })
  m.tick()
  const r = served(m)
  assert.equal(r.kind, 'result')
  assert.equal(r.seq, 's1')
  assert.equal(r.ok, true)
  assert.equal(r.result, 42)
  console.log('✔ shared-context result served via globalThis stash')
}

// 2b. return-style results are captured too
{
  const m = makeMockApi({ execMode: 'shared' })
  m.post({ type: 'script', code: 'return 7 * 6;', seq: 's1b' })
  m.tick()
  const r = served(m)
  assert.equal(r.result, 42)
  console.log('✔ return-style results captured')
}

// 3. isolated context: result arrives via loopback POST — same tick, thanks
//    to the post-queue drain loop
{
  const m = makeMockApi({ execMode: 'isolated' })
  m.post({ type: 'script', code: '__result = { a: 1 };', seq: 's2' })
  m.tick() // executes; stash missed; loopback post queued AND drained this tick
  const r = served(m)
  assert.equal(r.kind, 'result')
  assert.equal(r.seq, 's2')
  assert.equal(r.result.a, 1)
  assert.ok(m.state.clientPosts.length >= 1)
  console.log('✔ isolated-context result served via loopback POST (same tick)')
}

// 4. thrown errors are captured, not swallowed
{
  const m = makeMockApi({ execMode: 'shared' })
  m.post({ type: 'script', code: 'throw new Error("boom");', seq: 's3' })
  m.tick()
  const r = served(m)
  assert.equal(r.ok, false)
  assert.match(r.error, /boom/)
  assert.match(r.stack, /boom/)
  assert.deepEqual(m.state.undo, ['start:AI Motion Batch', 'end'])
  console.log('✔ script errors captured; Undo group closes in finally')
}

// 5. expression posts report applied/skipped
{
  const m = makeMockApi()
  m.state.selected = ['javaScriptShape#1', 'textShape#2']
  m.post({ type: 'javaScriptShape', code: 'return shape', seq: 's4' })
  m.tick()
  const r = served(m)
  assert.equal(r.ok, true)
  assert.deepEqual(r.applied, ['javaScriptShape#1'])
  assert.deepEqual(r.skipped, ['name of textShape#2'])
  console.log('✔ expression post reports applied/skipped lists')
}

// 6. stallion.json config: port + token
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-cfg-'))
  fs.writeFileSync(path.join(dir, 'stallion.json'), JSON.stringify({ port: 9090, token: 'sekrit' }))
  const m = makeMockApi({ appDataFolder: dir })
  assert.deepEqual(m.state.listenArgs, { host: '127.0.0.1', port: 9090 })
  assert.equal(m.state.tokenAuth, 'sekrit')
  m.post({ type: 'script', code: '__result = 1;', seq: 's5' })
  m.tick()
  const r = served(m)
  assert.equal(r.result, 1)
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('✔ stallion.json overrides port and enables token auth')
}

// 7. deterministic receipt: sceneStateHash + consoleDiagnostics + beatBBoxes
{
  const m = makeMockApi({ execMode: 'shared' })
  m.post({
    type: 'script',
    code: 'console.warn("careful"); __result = "done";',
    seq: 's6',
    beatFrames: [12, 24],
  })
  m.tick()
  const r = served(m)
  assert.equal(r.ok, true)
  const receipt = r.receipt
  assert.match(receipt.sceneStateHash, /^[0-9a-f]{16}$/)
  assert.equal(receipt.consoleDiagnostics.length, 1)
  assert.equal(receipt.consoleDiagnostics[0].level, 'warn')
  assert.equal(receipt.consoleDiagnostics[0].text, 'careful')
  assert.deepEqual(Object.keys(receipt.beatBBoxes).sort(), ['12', '24'])
  assert.equal(receipt.beatBBoxes['12']['basicShape#1'].width, 10)
  // the playhead is restored after beat evaluation
  assert.equal(m.state.frame, 7)
  // an identical scene reads the same hash; a different scene would not
  const hashA = receipt.sceneStateHash
  m.post({ type: 'script', code: '__result = 1;', seq: 's6b' })
  m.tick()
  assert.equal(served(m).receipt.sceneStateHash, hashA)
  console.log('✔ deterministic receipt: hash, console diagnostics, beat bboxes')
}

// 8. diagnostics probes record invalid attribute paths and dead connections
{
  const m = makeMockApi({ execMode: 'shared' })
  m.api.getAttributeDefinition = (id, attr) => (attr === 'position.x' ? { name: attr } : null)
  m.api.connect = () => {}
  m.post({
    type: 'script',
    code: 'api.set("basicShape#1", { "bogus.attr": 1 }); api.connect("basicShape#1", "position.x", "ghost#2", "position.x"); __result = 1;',
    seq: 's7',
    diagnostics: true,
  })
  m.tick()
  const r = served(m)
  assert.ok(r.receipt.apiDiagnostics, 'expected apiDiagnostics on the receipt')
  assert.ok(r.receipt.apiDiagnostics.invalidAttrs.some((entry) => entry.includes('bogus.attr')), JSON.stringify(r.receipt.apiDiagnostics))
  assert.ok(r.receipt.apiDiagnostics.failedConnections.some((entry) => entry.includes('ghost#2')), JSON.stringify(r.receipt.apiDiagnostics))
  console.log('✔ diagnostics probes surface invalid attrs and dead connections')
}

console.log('\nAll bridge protocol assertions passed.')
