/** Mock-wire coverage for the atomic batchEvalAndCapture surface. */
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

const request = (extra = {}) => ({
	type: 'batchEvalAndCapture', transactionId: 'mock-tx', undoGroupName: 'Mock batch', seq: 'mock-seq',
	code: `var hero = api.primitive('rectangle', 'Hero');
		api.set(hero, { 'generator.dimensions': [200, 100], position: [0, 0] });
		api.keyframe(hero, 0, { 'position.x': 0 });
		api.keyframe(hero, 24, { 'position.x': 100 });
		globalThis.__refcloneLayerMap.hero = hero;`,
	sampleFrames: [0, 24], inspectLayerIds: ['hero'], ...extra,
})

async function batch(handle, payload) {
	const ack = await handle.post(payload)
	assert.deepEqual(ack, { ok: true }, 'POST /post only acknowledges enqueue')
	return await handle.get()
}

test('mock heartbeat advertises batch capture without claiming rollback', async () => {
	await withServer(async (handle) => {
		const status = await handle.get()
		assert.equal(status.capabilities.batchEvalAndCapture, true)
		assert.equal(status.capabilities.batchEvalAndCaptureRollback, false)
	})
})

test('mock POST ack and GET carry the canonical correlated batch envelope', async () => {
	await withServer(async (handle) => {
		const envelope = await batch(handle, request())
		assert.equal(envelope.kind, 'batchEvalAndCapture')
		assert.equal(envelope.seq, 'mock-seq')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.transactionId, 'mock-tx')
		assert.match(envelope.layerMap.hero, /^basicShape#/)
		assert.equal(envelope.transformSpace, 'local')
		assert.ok(Number.isFinite(envelope.executionTimeMs))
		for (const key of ['width', 'height', 'fps', 'startFrame', 'endFrame']) assert.ok(Number.isFinite(envelope.compInfo[key]))
		assert.equal(envelope.frames['0'].layerMetrics.hero.worldTransform.posX, 0)
		assert.equal(envelope.frames['24'].layerMetrics.hero.worldTransform.posX, 100)
		for (const frame of ['0', '24']) {
			const metrics = envelope.frames[frame].layerMetrics.hero
			for (const key of ['x', 'y', 'width', 'height', 'centreX', 'centreY']) assert.ok(Number.isFinite(metrics.bbox[key]))
		}
		// The internal loopback channel serves the same canonical document verbatim.
		assert.deepEqual(await handle.post({ type: '__stallion_result__', batchEvalAndCaptureResult: envelope }), { ok: true })
		assert.deepEqual(await handle.get(), envelope)
	})
})

test('mock batch renders real PNGs and reuses an existing output directory', async () => {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-mock-batch-'))
	try {
		await withServer(async (handle) => {
			const payload = request({ sampleFrames: [0, 3], renderConfig: { enabled: true, outputDir: outDir, scaleFactor: 0.5 } })
			const first = await batch(handle, payload)
			assert.equal(first.ok, true, JSON.stringify(first.error))
			for (const frame of [0, 3]) {
				const file = first.frames[String(frame)].renderedPngPath
				assert.equal(file, path.join(outDir, `frame_${frame}.png`).replace(/\\/g, '/'))
				assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0)
				assert.deepEqual([...fs.readFileSync(file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
			}
			const second = await batch(handle, { ...payload, transactionId: 'mock-tx-2', seq: 'mock-seq-2' })
			assert.equal(second.ok, true, JSON.stringify(second.error))
			assert.equal(second.seq, 'mock-seq-2')
		})
	} finally { fs.rmSync(outDir, { recursive: true, force: true }) }
})

test('mock rollback request fails before mutation because api.undo is absent', async () => {
	await withServer(async (handle) => {
		const before = handle.api.getCompLayers(false).length
		const envelope = await batch(handle, request({ rollbackOnError: true }))
		assert.equal(envelope.ok, false)
		assert.equal(envelope.kind, 'batchEvalAndCapture')
		assert.match(envelope.error.message, /Unsupported rollback.*api.undo/)
		assert.deepEqual(envelope.frames, {})
		assert.equal(envelope.layerMap, undefined)
		assert.equal(handle.api.getCompLayers(false).length, before)
	})
})

test('mock validation errors keep the canonical failure shape and seq', async () => {
	await withServer(async (handle) => {
		const envelope = await batch(handle, request({ transactionId: undefined }))
		assert.equal(envelope.ok, false)
		assert.equal(envelope.kind, 'batchEvalAndCapture')
		assert.equal(envelope.seq, 'mock-seq')
		assert.match(envelope.error.message, /transactionId/)
		assert.deepEqual(envelope.frames, {})
	})
})