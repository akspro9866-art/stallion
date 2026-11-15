/**
 * Scene-hash contract tests — run with `npm test`.
 *
 * The `scene_hash` action is the fast deterministic scene-tree checksum: an
 * FNV-1a digest over the ACTIVE comp's layer ids in hierarchy order plus every
 * incoming behaviour connection and its current evaluated value. The full
 * scene graph never crosses HTTP — only the 16-hex digest does. Both the
 * `type`-shaped POST /post request (what a live bridge can serve) and the
 * mock-only path-shaped GET /scene_hash route must return the same envelope.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { startMockServer } from '../../dist/stallion-mock.mjs'

async function getJson(handle, route = '/get') {
	const response = await fetch(`http://127.0.0.1:${handle.port}${route}`)
	assert.equal(response.status, 200, `${route} -> ${response.status}`)
	return response.json()
}

async function postJson(handle, pathname, payload) {
	const response = await fetch(`http://127.0.0.1:${handle.port}${pathname}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	})
	return { status: response.status, body: await response.json() }
}

const SCENE_SCRIPT = `
	var card = api.primitive('rectangle', 'card');
	api.set(card, { 'generator.dimensions': [200, 100], position: [0, -50] });
	var driver = api.create('value', 'driver');
	api.set(driver, { value: 42 });
	api.connect(driver, 'id', card, 'opacity');
	return { card: card, driver: driver };
`

/** POST an action, then read its envelope off GET /get (the ack-then-poll contract). */
async function runAction(handle, payload) {
	const { body: ack } = await postJson(handle, '/post', payload)
	assert.equal(ack.ok, true, JSON.stringify(ack))
	return getJson(handle)
}

async function withScene(fn) {
	const handle = await startMockServer({ port: 0 })
	try {
		const envelope = await runAction(handle, { type: 'script', seq: 'build', code: SCENE_SCRIPT })
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		return await fn(handle, envelope.result)
	} finally {
		await handle.close()
	}
}

test('scene_hash answers the type-shaped POST /post request', async () => {
	await withScene(async (handle) => {
		const envelope = await runAction(handle, { type: 'scene_hash', seq: 'sh-1' })
		assert.equal(envelope.ok, true)
		assert.equal(envelope.kind, 'scene_hash')
		assert.equal(envelope.seq, 'sh-1')
		assert.match(envelope.hash, /^[0-9a-f]{16}$/)
		assert.equal(envelope.algorithm, 'fnv1a-32x2')
		assert.equal(envelope.layerCount, 2)
		assert.equal(envelope.connectionCount, 1)
	})
})

test('scene_hash answers the mock-only path-shaped GET route identically', async () => {
	await withScene(async (handle) => {
		const typed = await runAction(handle, { type: 'scene_hash', seq: 'sh-a' })
		const pathed = await getJson(handle, '/scene_hash?seq=sh-b')
		assert.equal(pathed.ok, true)
		assert.equal(pathed.kind, 'scene_hash')
		// Byte-identical digests — the seq differs, the hash must not.
		assert.equal(pathed.hash, typed.hash)
		assert.equal(pathed.algorithm, typed.algorithm)
		assert.equal(pathed.layerCount, typed.layerCount)
		assert.equal(pathed.connectionCount, typed.connectionCount)
	})
})

test('scene_hash is deterministic for an unchanged scene', async () => {
	await withScene(async (handle) => {
		const first = await getJson(handle, '/scene_hash')
		const second = await getJson(handle, '/scene_hash')
		assert.equal(first.hash, second.hash)
	})
})

test('scene_hash changes when a connected behaviour value moves', async () => {
	await withScene(async (handle, ids) => {
		const baseline = await getJson(handle, '/scene_hash')
		// The value node drives card.opacity — the digest covers the CONNECTED
		// destination attribute's evaluated value, so moving the driver moves it.
		const envelope = await runAction(handle, {
			type: 'script',
			seq: 'mutate',
			code: `api.set(${JSON.stringify(ids.driver)}, { value: 99 }); return 1;`,
		})
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		const afterValueChange = await getJson(handle, '/scene_hash')
		assert.notEqual(afterValueChange.hash, baseline.hash, 'connected behaviour value must feed the digest')
	})
})

test('scene_hash changes when the layer hierarchy changes', async () => {
	await withScene(async (handle) => {
		const baseline = await getJson(handle, '/scene_hash')
		const envelope = await runAction(handle, {
			type: 'script',
			seq: 'add',
			code: `var extra = api.primitive('ellipse', 'extra'); return extra;`,
		})
		assert.equal(envelope.ok, true)
		const afterAdd = await getJson(handle, '/scene_hash')
		assert.notEqual(afterAdd.hash, baseline.hash)
		assert.equal(afterAdd.layerCount, baseline.layerCount + 1)
	})
})

test('scene_hash heartbeat capability advertises the algorithm', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const status = await getJson(handle)
		assert.equal(status.capabilities.sceneHash, true)
		assert.equal(status.capabilities.sceneHashAlgorithm, 'fnv1a-32x2')
	} finally {
		await handle.close()
	}
})
