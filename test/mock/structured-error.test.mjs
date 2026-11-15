/**
 * Structured IIFE exception telemetry tests — run with `npm test`.
 *
 * A failing script must return a machine-readable payload —
 * { ok, errorType, message, lineOffset, columnOffset, lastLayerId,
 *   lastAttributePath, snippet } — whose line/column coordinates point INTO
 * THE USER'S ORIGINAL SCRIPT (the undo-group wrapper and the `helpers: true`
 * `_mg` preamble are subtracted out), so refclone and cavalry-mcp can locate
 * the failing statement without re-running anything.
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

/** Drive a script post and pull its result envelope off GET /get. */
async function runScript(handle, payload) {
	const { body: ack } = await postJson(handle, '/post', { type: 'script', seq: 'diag', ...payload })
	assert.equal(ack.ok, true)
	const envelope = await getJson(handle)
	return envelope
}

test('a failing script returns the full structured telemetry payload', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const envelope = await runScript(handle, {
			code: "var ok = api.primitive('rectangle', 'card');\napi.set(ok, { position: [10, 20] });\nthrow new Error('boom mid-script');",
		})
		assert.equal(envelope.ok, false)
		assert.equal(envelope.errorType, 'Error')
		assert.equal(envelope.message, 'boom mid-script')
		assert.equal(envelope.error, 'boom mid-script')
		// The throw is on line 3 of the user script — wrapper lines subtracted.
		assert.equal(envelope.lineOffset, 3)
		// The last mutation before the throw was api.set on the created card.
		const created = envelope.state && Array.isArray(envelope.state.createdLayerIds) ? envelope.state.createdLayerIds : []
		assert.equal(envelope.lastLayerId, created[0] ?? null)
		assert.equal(envelope.lastAttributePath, 'position')
	} finally {
		await handle.close()
	}
})

test('the failing line snippet carries a caret at the reported column', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const envelope = await runScript(handle, {
			code: "var layer = api.primitive('rectangle', 'card');\napi.set(layer, { position: [1, 2] });\napi.missingCallGoesBoom(layer);",
		})
		assert.equal(envelope.ok, false)
		assert.equal(envelope.lineOffset, 3)
		assert.equal(typeof envelope.snippet, 'string')
		assert.ok(envelope.snippet.includes('api.missingCallGoesBoom'), envelope.snippet)
		const [line, caret] = String(envelope.snippet).split('\n')
		assert.equal(line, 'api.missingCallGoesBoom(layer);')
		// The caret sits under the failing expression start (whitespace before it).
		assert.match(caret, /^\s*\^\s*$/)
		assert.equal(caret.indexOf('^') + 1, envelope.columnOffset)
	} finally {
		await handle.close()
	}
})

test('the last mutated layer id and attribute path are reported', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const envelope = await runScript(handle, {
			code: "var card = api.primitive('rectangle', 'card');\napi.set(card, { 'position.x': 42 });\napi.connect(card, 'id', card, 'rotation');\napi.nonexistent(layerUnknown);",
		})
		assert.equal(envelope.ok, false)
		// The connect() into card.rotation is the last successful mutation.
		assert.equal(envelope.lastLayerId, cardId(envelope))
		assert.equal(envelope.lastAttributePath, 'rotation')
	} finally {
		await handle.close()
	}
	function cardId(env) {
		// The created layer id is present in the execution snapshot.
		const created = env.state && Array.isArray(env.state.createdLayerIds) ? env.state.createdLayerIds : []
		return created[0] ?? null
	}
})

test('coordinates survive the helpers:true _mg preamble', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const envelope = await runScript(handle, {
			helpers: true,
			code: "var first = 1;\nvar second = 2;\nthrow new TypeError('preamble-shifted boom');",
		})
		assert.equal(envelope.ok, false)
		assert.equal(envelope.errorType, 'TypeError')
		// The throw sits on line 3 of the USER script even though the injected
		// _mg preamble pushes it dozens of lines deeper into the vm source.
		assert.equal(envelope.lineOffset, 3)
		assert.ok(String(envelope.snippet).includes('throw new TypeError'), envelope.snippet)
	} finally {
		await handle.close()
	}
})

test('successful scripts carry no telemetry fields', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const envelope = await runScript(handle, { code: "var layer = api.primitive('ellipse', 'dot'); return layer;" })
		assert.equal(envelope.ok, true)
		for (const field of ['errorType', 'message', 'lineOffset', 'columnOffset', 'lastLayerId', 'lastAttributePath', 'snippet']) {
			assert.equal(field in envelope, false, `${field} must be absent on success`)
		}
	} finally {
		await handle.close()
	}
})

test('keep-alive headers advertise connection reuse', async () => {
	const handle = await startMockServer({ port: 0, keepAliveTimeoutMs: 7000 })
	try {
		const response = await fetch(`http://127.0.0.1:${handle.port}/health`)
		assert.equal(response.headers.get('connection'), 'keep-alive')
		assert.match(response.headers.get('keep-alive') ?? '', /timeout=7/)
	} finally {
		await handle.close()
	}
})
