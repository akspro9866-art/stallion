/**
 * determinism-check contract tests — run with `npm test`.
 *
 * The mock bridge evaluates a submitted frame function across the 7 evaluation
 * orders (framewright's probe matrix) in isolated vm sandboxes and answers with
 * a DeterminismReport plus the standard receipt. Two request shapes reach one
 * handler: `type`-shaped on POST /post (ack-then-poll via GET /get, what a live
 * bridge can do) and the mock-only literal GET|POST /determinism-check route,
 * which answers directly. The static lint (lintDeterminismSource) is the purity
 * gate for this surface; the 7-order check is the authority on frame-order state.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
	startMockServer,
	DETERMINISM_TYPE,
	DETERMINISM_ORDERS,
	lintDeterminismSource,
	normalizeDeterminismJob,
} from '../../dist/stallion-mock.mjs'

const PURE_CODE = '(t, seed, width) => ({ t, v: ((t * 2654435761 + seed * 40503 + width) >>> 0) % 1000 })'
const COUNTER_CODE = 'let calls = 0; function frame(t, seed, width) { calls += 1; return { t, calls }; }'
const RANDOM_CODE = '(t) => ({ t, r: Math.random() })'

async function withServer(fn, options = {}) {
	const handle = await startMockServer({ port: 0, ...options })
	try {
		return await fn(handle)
	} finally {
		await handle.close()
	}
}

async function postJson(handle, pathname, payload, token) {
	const headers = { 'content-type': 'application/json' }
	if (token) headers.authorization = `Bearer ${token}`
	const response = await fetch(`http://127.0.0.1:${handle.port}${pathname}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(payload),
	})
	return { status: response.status, body: await response.json() }
}

async function getJson(handle, route = '/get', token) {
	const headers = token ? { authorization: `Bearer ${token}` } : {}
	const response = await fetch(`http://127.0.0.1:${handle.port}${route}`, { headers })
	return { status: response.status, body: await response.json() }
}

/** type-shaped request: POST /post ack, then poll GET /get for the envelope. */
async function check(handle, payload) {
	const { status, body: ack } = await postJson(handle, '/post', { type: DETERMINISM_TYPE, ...payload })
	assert.equal(status, 200)
	assert.deepEqual(ack, { ok: true })
	const { body: envelope } = await getJson(handle)
	return envelope
}

test('heartbeat advertises the determinismCheck capability', async () => {
	await withServer(async (handle) => {
		const { body: status } = await getJson(handle)
		assert.equal(status.kind, 'status')
		assert.equal(status.capabilities.determinismCheck, true)
	})
})

test('a pure frame function passes all 7 orders with the standard receipt', async () => {
	await withServer(async (handle) => {
		const layersBefore = handle.scene.layers.size
		const envelope = await check(handle, { seq: 'det-pure', code: PURE_CODE })
		assert.equal(envelope.kind, DETERMINISM_TYPE)
		assert.equal(envelope.seq, 'det-pure')
		assert.equal(envelope.ok, true)
		assert.equal(envelope.deterministic, true)
		assert.deepEqual(envelope.orders, [...DETERMINISM_ORDERS])
		assert.equal(envelope.orders.length, 7)
		// defaults: frameCount 120, seed 7, width 480, framewright probe set
		assert.equal(envelope.frameCount, 120)
		assert.equal(envelope.seed, 7)
		assert.equal(envelope.width, 480)
		assert.deepEqual(envelope.frames, [0, 30, 60, 90, 119])
		assert.equal(envelope.probes, 5)
		assert.ok(envelope.evaluations >= 7 * 5, `expected >= 35 evaluations, got ${envelope.evaluations}`)
		assert.equal(envelope.mismatchCount, 0)
		assert.deepEqual(envelope.mismatches, [])
		assert.deepEqual(envelope.errors, [])
		assert.equal(envelope.setupError, null)
		assert.equal(envelope.truncated, false)
		assert.equal(envelope.lint.passed, true)
		assert.deepEqual(envelope.lint.violations, [])
		// standard receipt shape, and the check never touches the scene
		assert.match(envelope.receipt.sceneStateHash, /^[0-9a-f]{16}$/)
		assert.deepEqual(envelope.receipt.consoleDiagnostics, [])
		assert.deepEqual(envelope.receipt.beatBBoxes, {})
		assert.equal(handle.scene.layers.size, layersBefore)
		assert.equal(handle.scene.lastUndo, null)
	})
})

test('script form defining a global frame(t, seed, width) is accepted', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, {
			seq: 'det-script',
			code: 'function frame(t, seed, width) { return t * 2 + seed + width; }',
			frameCount: 24,
		})
		assert.equal(envelope.ok, true)
		assert.equal(envelope.deterministic, true)
		assert.deepEqual(envelope.frames, [0, 6, 12, 18, 23])
	})
})

test('a closure counter is flagged with mismatches grouped by hash', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, { seq: 'det-counter', code: COUNTER_CODE })
		assert.equal(envelope.ok, false)
		assert.equal(envelope.deterministic, false)
		assert.equal(envelope.mismatchCount, 5)
		assert.equal(envelope.mismatches.length, 5)
		const first = envelope.mismatches[0]
		assert.equal(first.frame, 0)
		assert.match(first.detail, /vs/)
		assert.notEqual(first.hashes.forward, first.hashes.backward)
		assert.notEqual(first.hashes.forward, first.hashes['after-sweep'])
		// no banned API: the lint passes and the 7-order check is the authority
		assert.equal(envelope.lint.passed, true)
		assert.deepEqual(envelope.errors, [])
		assert.equal(envelope.setupError, null)
	})
})

test('Math.random fails the lint gate and the dynamic check', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, { seq: 'det-random', code: RANDOM_CODE })
		assert.equal(envelope.ok, false)
		assert.equal(envelope.deterministic, false)
		assert.equal(envelope.lint.passed, false)
		const violation = envelope.lint.violations.find((v) => v.severity === 'fail')
		assert.ok(violation, JSON.stringify(envelope.lint))
		assert.equal(violation.rule, 'nondeterministic_source')
		assert.equal(violation.line, 1)
		assert.match(violation.message, /Math\.random/)
		assert.ok(envelope.mismatchCount > 0)
	})
})

test('Date.now fails the lint gate even when the orders agree', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, { seq: 'det-date', code: '(t) => Date.now() + t' })
		assert.equal(envelope.ok, false)
		assert.equal(envelope.lint.passed, false)
		assert.ok(envelope.lint.violations.some((v) => v.rule === 'nondeterministic_source' && /Date/.test(v.message)))
	})
})

test('a global write warns as frame_order_state; an input-keyed cache still passes', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, {
			seq: 'det-cache',
			code: 'globalThis.__cache = globalThis.__cache || {};\nfunction frame(t, seed, width) { globalThis.__cache[t] = t * width; return globalThis.__cache[t]; }',
		})
		assert.equal(envelope.lint.passed, true)
		assert.ok(envelope.lint.violations.some((v) => v.rule === 'frame_order_state' && v.severity === 'warn'))
		assert.equal(envelope.deterministic, true)
		assert.equal(envelope.ok, true)
	})
})

test('lint:false skips the static gate but the dynamic check still runs', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, { seq: 'det-nolint', code: RANDOM_CODE, lint: false })
		assert.equal(envelope.lint.passed, true)
		assert.deepEqual(envelope.lint.violations, [])
		assert.equal(envelope.deterministic, false)
		assert.equal(envelope.ok, false)
		assert.ok(envelope.mismatchCount > 0)
	})
})

test('a setup failure is reported once, not once per order', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, { seq: 'det-setup', code: 'var notAFunction = 42;' })
		assert.equal(envelope.ok, false)
		assert.equal(envelope.deterministic, false)
		assert.match(envelope.setupError, /function/)
		assert.deepEqual(envelope.errors, [])
		assert.deepEqual(envelope.mismatches, [])
	})
})

test('a throwing frame function surfaces per-frame errors', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, {
			seq: 'det-throw',
			code: '(t) => { if (t === 30) throw new Error("boom"); return t; }',
		})
		assert.equal(envelope.ok, false)
		assert.equal(envelope.deterministic, false)
		assert.ok(envelope.errors.length > 0)
		assert.ok(envelope.errors.some((e) => e.frame === 30 && /boom/.test(e.error)))
		assert.equal(envelope.mismatchCount, 0)
	})
})

test('budget exhaustion truncates the check and a truncated check never passes', async () => {
	await withServer(async (handle) => {
		const envelope = await check(handle, {
			seq: 'det-budget',
			code: '(t) => { let x = 0; for (let i = 0; i < 2e7; i++) x += i; return x + t; }',
			budgetMs: 1,
		})
		assert.equal(envelope.truncated, true)
		assert.equal(envelope.deterministic, false)
		assert.equal(envelope.ok, false)
	})
})

test('limits: probe count, frameCount and code bytes are schema-rejected', async () => {
	await withServer(async (handle) => {
		const cases = [
			[{ frames: Array.from({ length: 65 }, (_, i) => i) }, /1\.\.64/],
			[{ frames: [] }, /1\.\.64/],
			[{ frameCount: 0 }, /frameCount/],
			[{ frameCount: 10001 }, /frameCount/],
			[{ code: 'x'.repeat(200001) }, /exceeds 200000 bytes/],
			[{ code: '   ' }, /non-empty/],
			[{ frames: 'nope' }, /must be an array/],
			[{ frames: [-1] }, /0\.\.1000000/],
			[{ width: 0 }, /width/],
			[{ seed: 'abc' }, /seed/],
		]
		for (const [extra, pattern] of cases) {
			const envelope = await check(handle, { seq: 'det-limit', code: PURE_CODE, ...extra })
			assert.equal(envelope.ok, false, JSON.stringify(extra))
			assert.equal(envelope.kind, DETERMINISM_TYPE)
			assert.equal(envelope.code, 'STALLION_BAD_REQUEST')
			assert.equal(envelope.seq, 'det-limit')
			assert.match(envelope.error, pattern)
		}
		// missing code entirely
		const missing = await check(handle, { seq: 'det-nocode' })
		assert.equal(missing.ok, false)
		assert.equal(missing.code, 'STALLION_BAD_REQUEST')
		assert.match(missing.error, /non-empty/)
	})
})

test('token auth protects both determinism surfaces', async () => {
	await withServer(
		async (handle) => {
			const payload = { type: DETERMINISM_TYPE, seq: 'det-auth', code: PURE_CODE, frameCount: 24 }
			const noToken = await postJson(handle, '/post', payload)
			assert.equal(noToken.status, 401)
			const literalNoToken = await postJson(handle, '/determinism-check', { seq: 'det-auth', code: PURE_CODE })
			assert.equal(literalNoToken.status, 401)
			const queryNoToken = await getJson(handle, `/determinism-check?code=${encodeURIComponent(PURE_CODE)}`)
			assert.equal(queryNoToken.status, 401)
			const wrongToken = await postJson(handle, '/post', payload, 'nope')
			assert.equal(wrongToken.status, 401)
			const goodToken = await postJson(handle, '/post', payload, 'sekrit')
			assert.equal(goodToken.status, 200)
			const polled = await getJson(handle, '/get', 'sekrit')
			assert.equal(polled.status, 200)
			assert.equal(polled.body.ok, true)
			assert.equal(polled.body.seq, 'det-auth')
		},
		{ token: 'sekrit' },
	)
})

test('seq matching: the latest result replaces and both outcomes echo the seq', async () => {
	await withServer(async (handle) => {
		const a = await check(handle, { seq: 'det-a', code: PURE_CODE, frameCount: 24 })
		assert.equal(a.seq, 'det-a')
		assert.equal(a.ok, true)
		const b = await check(handle, { seq: 'det-b', code: COUNTER_CODE, frameCount: 24 })
		assert.equal(b.seq, 'det-b')
		assert.equal(b.ok, false)
		const c = await check(handle, { seq: 'det-c', code: '' })
		assert.equal(c.seq, 'det-c')
		assert.equal(c.ok, false)
		assert.equal(c.code, 'STALLION_BAD_REQUEST')
	})
})

test('literal POST /determinism-check answers the identical envelope directly', async () => {
	await withServer(async (handle) => {
		const payload = { seq: 'det-lit', code: PURE_CODE, frameCount: 24 }
		const { status, body: direct } = await postJson(handle, '/determinism-check', payload)
		assert.equal(status, 200)
		assert.equal(direct.kind, DETERMINISM_TYPE)
		assert.equal(direct.seq, 'det-lit')
		assert.equal(direct.ok, true)
		// the literal answer is also the pollable last result
		const { body: polled } = await getJson(handle)
		assert.deepEqual(polled, direct)
		// and the type-shaped surface produces the same envelope
		const typed = await check(handle, payload)
		assert.deepEqual(typed, direct)
	})
})

test('GET /determinism-check accepts the query-string form', async () => {
	await withServer(async (handle) => {
		const query = `/determinism-check?seq=det-q&frameCount=24&frames=0,12&code=${encodeURIComponent('(t, seed, width) => t * width + seed')}`
		const { status, body } = await getJson(handle, query)
		assert.equal(status, 200)
		assert.equal(body.kind, DETERMINISM_TYPE)
		assert.equal(body.seq, 'det-q')
		assert.equal(body.ok, true)
		assert.deepEqual(body.frames, [0, 12])
		assert.equal(body.probes, 2)
		assert.equal(body.frameCount, 24)
	})
})

test('lintDeterminismSource masks comments and strings, catches banned APIs', () => {
	const masked = lintDeterminismSource('// Math.random() is banned in comments\nconst s = "Date.now()";\n(t) => t')
	assert.equal(masked.passed, true)
	assert.deepEqual(masked.violations, [])
	for (const source of [
		'(t) => Math.random() + t',
		'(t) => Date.now() + t',
		'(t) => new Date().getTime() + t',
		'(t) => performance.now() + t',
		'(t) => crypto.getRandomValues(new Uint8Array(4))[0] + t',
	]) {
		const result = lintDeterminismSource(source)
		assert.equal(result.passed, false, source)
		assert.equal(result.violations[0].rule, 'nondeterministic_source')
		assert.equal(result.violations[0].severity, 'fail')
		assert.equal(result.violations[0].line, 1)
	}
})

test('normalizeDeterminismJob sorts and dedupes probes and applies defaults', () => {
	const normalized = normalizeDeterminismJob({ seq: 'n', code: '(t) => t', frames: [9, 3, 3, 0], frameCount: 24 })
	assert.ok('job' in normalized)
	assert.deepEqual(normalized.job.frames, [0, 3, 9])
	assert.equal(normalized.job.frameCount, 24)
	assert.equal(normalized.job.seed, 7)
	assert.equal(normalized.job.width, 480)
	assert.equal(normalized.job.lint, true)
	assert.equal(normalized.job.budgetMs, 30000)
	const rejected = normalizeDeterminismJob({ code: '(t) => t', frames: [] })
	assert.ok('error' in rejected)
	assert.equal(rejected.code, 'STALLION_BAD_REQUEST')
})