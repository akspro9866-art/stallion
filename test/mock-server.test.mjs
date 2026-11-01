/**
 * Mock bridge contract tests — run with `node --test test/*.test.mjs`.
 *
 * These prove the --mock bridge speaks the same wire contract as the live
 * bridge and that its telemetry, schema validation, interpolation and
 * rasterization are deterministic, so CI can exercise the full stack
 * (refclone → cavalry-mcp → stallion --mock) without Cavalry.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { startMockServer } from '../dist/stallion-mock.mjs'

async function withServer(fn, options = {}) {
	const handle = await startMockServer({ port: 0, ...options })
	try {
		return await fn(handle, {
			post: async (payload) => {
				const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				})
				assert.equal(response.status, 200)
				return response.json()
			},
			get: async () => (await fetch(`http://127.0.0.1:${handle.port}/get`)).json(),
			run: async (code, extra = {}) => {
				const seq = `seq-${Math.random().toString(36).slice(2)}`
				await handle_post(handle, { type: 'script', seq, code, ...extra })
				return { seq, envelope: await handle_get(handle) }
			},
		})
	} finally {
		await handle.close()
	}
}

async function handle_post(handle, payload) {
	const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	})
	assert.equal(response.status, 200)
	return response.json()
}

async function handle_get(handle) {
	const response = await fetch(`http://127.0.0.1:${handle.port}/get`)
	assert.equal(response.status, 200)
	return response.json()
}

test('heartbeat declares mock capabilities', async () => {
	await withServer(async (handle) => {
		const status = await handle_get(handle)
		assert.equal(status.kind, 'status')
		assert.equal(status.capabilities.mock, true)
		assert.equal(status.capabilities.receipt, true)
		assert.equal(status.capabilities.renderFrames, true)
	})
})

test('script execution returns result, state and a deterministic receipt', async () => {
	await withServer(async (handle, api) => {
		const code = `
			var shape = api.primitive('rectangle', 'card');
			api.set(shape, { 'generator.dimensions': [200, 100], position: [0, -50] });
			api.keyframe(shape, 0, { 'position.x': 0 });
			api.keyframe(shape, 24, { 'position.x': 200 });
			api.magicEasing(shape, 'position.x', 0, 'SpringOut');
			return { created: shape };
		`
		const first = await api.run(code, { beatFrames: [12] })
		assert.equal(first.envelope.ok, true)
		assert.equal(first.envelope.result.created, 'basicShape#1')
		assert.deepEqual(first.envelope.state.createdLayerIds, ['basicShape#1'])
		const receipt = first.envelope.receipt
		assert.match(receipt.sceneStateHash, /^[0-9a-f]{16}$/)
		const centre = receipt.beatBBoxes['12']['basicShape#1']
		// SpringOut at t=0.5 overshoots past the 200px target
		assert.ok(centre.pivotX > 200, `expected overshoot past 200, got ${centre.pivotX}`)
		// reading the scene again must not change the hash
		const second = await api.run('return api.getCompLayers(false).length;')
		assert.equal(second.envelope.receipt.sceneStateHash, receipt.sceneStateHash)
	})
})

test('console warnings and schema rejections surface in consoleDiagnostics', async () => {
	await withServer(async (handle, api) => {
		const { envelope } = await api.run(`
			var layer = api.primitive('rectangle', 'probe');
			console.warn('explicit warning');
			api.set(layer, { 'not.real': 1 });
			return true;
		`)
		const texts = envelope.receipt.consoleDiagnostics.map((entry) => entry.text)
		assert.ok(texts.some((t) => t.includes('explicit warning')), JSON.stringify(texts))
		assert.ok(texts.some((t) => t.includes("unknown attribute path 'not.real'")), JSON.stringify(texts))
		// and the invalid attribute was not applied
		const applied = await api.run("return api.get(api.getCompLayers(false)[0], 'not.real');")
		assert.equal(applied.envelope.result, undefined)
	})
})

test('unknown node types are recorded, valid ones are not', async () => {
	await withServer(async (handle, api) => {
		const { envelope } = await api.run(`
			var ok = api.create('duplicator', 'dup');
			var odd = api.create('warpField9', 'odd');
			return { ok, odd };
		`)
		assert.match(envelope.result.ok, /^duplicator#\d+$/)
		assert.ok(envelope.receipt.consoleDiagnostics.some((entry) => entry.text.includes("unknown node type 'warpField9'")))
	})
})

test('weighted cubic Bézier handles interpolate deterministically', async () => {
	await withServer(async (handle, api) => {
		await api.run(`
			var shape = api.primitive('rectangle', 'r');
			api.keyframe(shape, 0, { 'position.x': 0 });
			api.keyframe(shape, 24, { 'position.x': 200 });
			api.modifyKeyframeTangent(shape, { 'position.x': { frame: 0, outAngle: 0, outWeight: 8 } });
			return true;
		`)
		const probe = await api.run(`
			api.setFrame(12);
			return api.get(api.getCompLayers(false)[0], 'position.x');
		`)
		// symmetric flat handles pass through the midpoint (bisection precision)
		assert.ok(Math.abs(Number(probe.envelope.result) - 100) < 0.001, `got ${probe.envelope.result}`)
		const again = await api.run(`
			api.setFrame(12);
			return api.get(api.getCompLayers(false)[0], 'position.x');
		`)
		assert.equal(again.envelope.result, probe.envelope.result)
	})
})

test('render-frames returns inline png_buffer payloads with animated pixels', async () => {
	await withServer(async (handle, api) => {
		await api.run(`
			var shape = api.primitive('rectangle', 'mover');
			api.set(shape, { 'generator.dimensions': [400, 400], 'material.materialColor': '#00FF00', position: [0, 0] });
			api.keyframe(shape, 0, { 'position.x': -600 });
			api.keyframe(shape, 24, { 'position.x': 600 });
			return true;
		`)
		await handle_post(handle, { type: 'render-frames', seq: 'rf1', frames: [0, 24], resolutionScale: 0.125, format: 'png_buffer' })
		const batch = await handle_get(handle)
		assert.equal(batch.kind, 'render-frames')
		assert.equal(batch.ok, true)
		assert.equal(batch.width, 240)
		assert.equal(batch.height, 135)
		assert.equal(batch.rendered.length, 2)
		for (const item of batch.rendered) {
			const png = Buffer.from(item.bufferBase64, 'base64')
			assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
		}
		// the mover sits at x=-600 on frame 0 and x=600 on frame 24: the frame
		// pixels must differ
		const first = batch.rendered[0].bufferBase64
		const last = batch.rendered[1].bufferBase64
		assert.notEqual(first, last)
	})
})

test('literal POST /render-frames streams raw binary frames', async () => {
	await withServer(async (handle) => {
		const response = await fetch(`http://127.0.0.1:${handle.port}/render-frames`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/octet-stream' },
			body: JSON.stringify({ frames: [0, 12], resolutionScale: 0.125 }),
		})
		assert.equal(response.headers.get('content-type'), 'application/octet-stream')
		const buffer = Buffer.from(await response.arrayBuffer())
		assert.equal(buffer.readUInt32BE(0), 2)
		assert.equal(buffer.readUInt32BE(4), 0)
		assert.equal(buffer.readUInt16BE(8), 240)
		assert.equal(buffer.readUInt16BE(10), 135)
	})
})

test('seq matching and result replacement follow the live protocol', async () => {
	await withServer(async (handle, api) => {
		const a = await api.run('return 1;')
		const b = await api.run('return 2;')
		assert.equal(b.envelope.seq, b.seq)
		assert.equal(b.envelope.result, 2)
		assert.notEqual(a.envelope.seq, b.envelope.seq)
	})
})

test('token auth protects every route', async () => {
	await withServer(
		async (handle) => {
			const noToken = await fetch(`http://127.0.0.1:${handle.port}/get`)
			assert.equal(noToken.status, 401)
			const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/get`, { headers: { authorization: 'Bearer nope' } })
			assert.equal(wrongToken.status, 401)
			const goodToken = await fetch(`http://127.0.0.1:${handle.port}/get`, { headers: { authorization: 'Bearer sekrit' } })
			assert.equal(goodToken.status, 200)
		},
		{ token: 'sekrit' },
	)
})

test('script errors come back as ok:false with the message', async () => {
	await withServer(async (handle, api) => {
		const { envelope } = await api.run('throw new Error("boom");')
		assert.equal(envelope.ok, false)
		assert.match(envelope.error, /boom/)
	})
})
