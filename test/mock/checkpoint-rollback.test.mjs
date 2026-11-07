// Mock-wire coverage for the checkpoint rollback strategy: real files, real
// restore, and the heartbeat capability flag (MockApi + MockScene + dispatcher).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startMockServer } from '../../dist/stallion-mock.mjs'

async function withServer(fn) {
	const handle = await startMockServer({ port: 0 })
	handle.post = async (payload) => {
		const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
		})
		assert.equal(response.status, 200)
		return response.json()
	}
	handle.get = async () => (await fetch(`http://127.0.0.1:${handle.port}/get`)).json()
	try { return await fn(handle) } finally { await handle.close() }
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-checkpoint-'))
const request = (checkpointPath, extra = {}) => ({
	type: 'batchEvalAndCapture', transactionId: 'mock-cp', undoGroupName: 'Mock checkpoint', seq: 'mock-cp-seq',
	code: `var hero = api.primitive('rectangle', 'Hero');
		api.set(hero, { 'generator.dimensions': [200, 100], position: [0, 0] });
		globalThis.__refcloneLayerMap.hero = hero;`,
	sampleFrames: [0], inspectLayerIds: ['hero'],
	rollbackOnError: true, rollbackStrategy: 'checkpoint', checkpointPath, ...extra,
})

async function batch(handle, payload) {
	assert.deepEqual(await handle.post(payload), { ok: true })
	return await handle.get()
}

async function stateIds(handle, seq) {
	assert.deepEqual(await handle.post({ type: 'state', seq, includeAttributes: false }), { ok: true })
	const envelope = await handle.get()
	assert.equal(envelope.kind, 'state')
	assert.equal(envelope.ok, true)
	return envelope.layers.map((l) => l.id).sort()
}

test('mock heartbeat advertises the checkpoint capability without claiming undo', async () => {
	await withServer(async (handle) => {
		const status = await handle.get()
		assert.equal(status.capabilities.batchEvalAndCapture, true)
		assert.equal(status.capabilities.batchEvalAndCaptureRollback, false)
		assert.equal(status.capabilities.batchEvalAndCaptureCheckpoint, true)
	})
})

test('checkpoint batch writes a real scene file and keeps successful mutations', async () => {
	const dir = tmp()
	await withServer(async (handle) => {
		const checkpointPath = path.join(dir, 'checkpoint.cv').replace(/\\/g, '/')
		const before = await stateIds(handle, 'state-before')
		const envelope = await batch(handle, request(checkpointPath))
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.rollbackStrategy, 'checkpoint')
		assert.equal(envelope.checkpoint.saved, true)
		assert.equal(envelope.checkpoint.path, checkpointPath)
		assert.ok(fs.existsSync(checkpointPath), 'the checkpoint is a real file')
		assert.ok(fs.statSync(checkpointPath).size > 0)
		assert.match(envelope.layerMap.hero, /^basicShape#/)
		const after = await stateIds(handle, 'state-after')
		assert.equal(after.length, before.length + 1, 'successful mutation persists')
	})
	fs.rmSync(dir, { recursive: true, force: true })
})

test('a failed checkpoint batch restores the exact pre-mutation scene', async () => {
	const dir = tmp()
	await withServer(async (handle) => {
		const checkpointPath = path.join(dir, 'rollback.cv').replace(/\\/g, '/')
		const before = await stateIds(handle, 'state-before')
		const envelope = await batch(handle, request(checkpointPath, {
			transactionId: 'mock-cp-fail', seq: 'mock-cp-fail-seq',
			code: `var hero = api.primitive('rectangle', 'Hero');
				globalThis.__refcloneLayerMap.hero = hero;
				throw new Error('deliberate mock failure');`,
		}))
		assert.equal(envelope.ok, false)
		assert.match(envelope.error.message, /deliberate mock failure/)
		assert.equal(envelope.checkpoint.saved, true)
		assert.equal(envelope.checkpoint.restored, true)
		assert.equal(envelope.checkpoint.sceneStateUnknown, undefined)
		assert.deepEqual(envelope.frames, {})
		const after = await stateIds(handle, 'state-after')
		assert.deepEqual(after, before, 'openScene restored the pre-mutation layer set')
	})
	fs.rmSync(dir, { recursive: true, force: true })
})

test('an existing checkpoint file is refused over the wire', async () => {
	const dir = tmp()
	await withServer(async (handle) => {
		const checkpointPath = path.join(dir, 'reuse.cv').replace(/\\/g, '/')
		assert.equal((await batch(handle, request(checkpointPath))).ok, true)
		const second = await batch(handle, request(checkpointPath, { transactionId: 'mock-cp-2', seq: 'mock-cp-seq-2' }))
		assert.equal(second.ok, false)
		assert.match(second.error.message, /already exists/)
	})
	fs.rmSync(dir, { recursive: true, force: true })
})