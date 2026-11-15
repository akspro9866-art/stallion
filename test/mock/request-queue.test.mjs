/**
 * FIFO request-queue tests — run with `npm test`.
 *
 * Heavy FFmpeg frame exports and multi-frame evaluations must never drop,
 * reorder, or block subsequent single-shot IIFE calls: every unit is
 * serialised through one tail and each unit is bounded by a per-request
 * EXECUTION timeout (the clock starts when the unit leaves the queue, so
 * waiting behind a legitimate export is never penalised).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestQueue } from '../../dist/stallion-mock.mjs'

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('RequestQueue serialises work in FIFO order', async () => {
	const queue = new RequestQueue()
	const order = []
	const jobs = [
		queue.enqueue(async () => {
			await tick(30)
			order.push('a')
			return 'a'
		}),
		queue.enqueue(async () => {
			order.push('b')
			return 'b'
		}),
		queue.enqueue(async () => {
			await tick(5)
			order.push('c')
			return 'c'
		}),
	]
	const results = await Promise.all(jobs)
	assert.deepEqual(order, ['a', 'b', 'c'])
	assert.deepEqual(results, ['a', 'b', 'c'])
})

test('RequestQueue counts pending (in-flight) units and total enqueued', async () => {
	const queue = new RequestQueue()
	let release
	const gate = new Promise((resolve) => {
		release = resolve
	})
	const first = queue.enqueue(() => {
		return gate.then(() => 'first')
	})
	assert.equal(queue.pending, 1, 'the gated unit is in flight')
	const second = queue.enqueue(async () => 'second')
	assert.equal(queue.pending, 2, 'both units are in flight (one running, one queued)')
	release()
	assert.equal(await first, 'first')
	assert.equal(await second, 'second')
	assert.equal(queue.total, 2)
	assert.equal(queue.pending, 0, 'all units settled')
})

test('RequestQueue rejects the caller on execution timeout but keeps the queue advancing', async () => {
	const queue = new RequestQueue({ timeoutMs: 60 })
	let slowFinished = false
	const slow = queue.enqueue(async () => {
		await tick(150)
		slowFinished = true
		return 'slow'
	})
	await assert.rejects(slow, /request timeout after 60ms/)
	// The queued unit still settles on its own; the tail must advance.
	const fast = queue.enqueue(async () => 'fast')
	assert.equal(await fast, 'fast')
	await tick(200)
	assert.equal(slowFinished, true)
})

test('RequestQueue does not penalise queue wait with the execution timeout', async () => {
	const queue = new RequestQueue({ timeoutMs: 80 })
	const first = queue.enqueue(() => {
		return tick(200).then(() => 'slow-export')
	})
	// The second unit waits ~200ms behind the first — far beyond the 80ms
	// ceiling — but its EXECUTION is quick, so it must still resolve.
	const second = queue.enqueue(async () => 'single-shot')
	await assert.rejects(first, /request timeout after 80ms/)
	assert.equal(await second, 'single-shot')
})

test('RequestQueue timeouts are configurable via the environment', async () => {
	const previous = process.env.STALLION_REQUEST_TIMEOUT_MS
	process.env.STALLION_REQUEST_TIMEOUT_MS = '1234'
	try {
		const queue = new RequestQueue()
		assert.equal(queue.timeoutMs, 1234)
	} finally {
		if (previous === undefined) delete process.env.STALLION_REQUEST_TIMEOUT_MS
		else process.env.STALLION_REQUEST_TIMEOUT_MS = previous
	}
})

test('RequestQueue reports thrown errors without blocking later units', async () => {
	const queue = new RequestQueue({ timeoutMs: 1000 })
	const boom = queue.enqueue(async () => {
		throw new Error('exploded')
	})
	await assert.rejects(boom, /exploded/)
	const after = await queue.enqueue(() => 'recovered')
	assert.equal(after, 'recovered')
})
