/**
 * Introspection contract tests — run with `npm test`.
 *
 * These exercise the readback and snapshot runtime *scripts* (the exact source
 * string the live bridge hands to `api.exec`), not a TypeScript re-implementation
 * of them: the mock runs `readbackScript` / `snapshotScript` through the same vm
 * sandbox it uses for user code. If the walk is wrong, CI sees it here rather than
 * in a live Cavalry session.
 *
 * Two request shapes reach one handler: `type`-shaped on POST /post (what a live
 * bridge can do — its WebServer has no router) and path-shaped GET/POST /state,
 * /layers, /frame, /snapshot (mock-only convenience). Both are asserted to produce
 * the same envelope.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startMockServer } from '../../dist/stallion-mock.mjs'
import { removeTreeSync } from '../helpers/fs-safe.mjs'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

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

/**
 * Build a small but representative scene: a parented card with an animated
 * position and a driven rotation, plus a plain shape, so hierarchy, evaluated
 * attributes and connections are all present in one readback.
 */
const SCENE_SCRIPT = `
	var grp = api.create('group', 'beat 02');
	var card = api.primitive('rectangle', 'card spring');
	api.set(card, { 'generator.dimensions': [200, 100], position: [0, -50] });
	api.keyframe(card, 0, { 'position.x': 0 });
	api.keyframe(card, 24, { 'position.x': 200 });
	var osc = api.create('oscillator', 'wiggle');
	api.connect(osc, 'id', card, 'rotation');
	api.parent(card, grp);
	var plain = api.primitive('ellipse', 'dot');
	return { grp: grp, card: card, osc: osc, plain: plain };
`

async function withScene(fn) {
	const handle = await startMockServer({ port: 0 })
	try {
		const { body: ack } = await postJson(handle, '/post', { type: 'script', seq: 'build', code: SCENE_SCRIPT })
		assert.equal(ack.ok, true)
		const built = await getJson(handle)
		assert.equal(built.ok, true, JSON.stringify(built.error))
		return await fn(handle, built.result)
	} finally {
		await handle.close()
	}
}

/** The stable part of an envelope: what a caller branches on. */
function comparable(envelope) {
	const { seq: _seq, elapsedMs: _elapsedMs, ...rest } = envelope
	return rest
}

test('heartbeat advertises introspection and the error envelope', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const status = await getJson(handle)
		assert.deepEqual(status.capabilities.introspect, ['state', 'layers', 'snapshot', 'snapshot-batch'])
		assert.equal(status.capabilities.errorEnvelope, 1)
		assert.equal(status.capabilities.mock, true)
	} finally {
		await handle.close()
	}
})

test('a readback is read-only: it opens no undo group', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		await postJson(handle, '/post', { type: 'script', seq: 's', code: "return api.primitive('rectangle', 'r');" })
		assert.equal(handle.scene.lastUndo?.name, 'AI Motion Batch')
		// atomic marker honoured: the walk must not nest another undo step
		await postJson(handle, '/post', { type: 'state', seq: 'r' })
		await getJson(handle)
		assert.equal(handle.scene.lastUndo?.name, 'AI Motion Batch')
		assert.equal(handle.scene.lastUndo?.createdLayerIds.length, 1)
	} finally {
		await handle.close()
	}
})

test('type-shaped state readback reports hierarchy, boxes and evaluated attrs', async () => {
	await withScene(async (handle, ids) => {
		const { body: ack } = await postJson(handle, '/post', { type: 'state', seq: 'st-1', frame: 12 })
		assert.equal(ack.ok, true)
		const envelope = await getJson(handle)
		assert.equal(envelope.kind, 'state')
		assert.equal(envelope.seq, 'st-1')
		assert.equal(envelope.ok, true)
		assert.equal(envelope.frame, 12)
		assert.equal(envelope.total, 4)
		assert.equal(envelope.returned, 4)
		assert.equal(envelope.truncated, false)
		assert.equal(envelope.nextOffset, -1)

		const byId = Object.fromEntries(envelope.layers.map((entry) => [entry.id, entry]))
		const card = byId[ids.card]
		assert.ok(card, `card ${ids.card} missing from ${JSON.stringify(Object.keys(byId))}`)
		// deterministic addressing
		assert.match(card.ref, /^basicShape#\d+$/)
		assert.equal(card.semanticId, `card_spring_${envelope.layers.indexOf(card)}`)
		assert.equal(card.semanticSlug, 'card_spring')
		// hierarchy: slug of the parent name is in the path chain, and depth agrees
		assert.equal(card.depth, 1)
		assert.equal(card.topLevel, false)
		assert.equal(card.path.length, 2)
		assert.match(card.path[0], /^beat_02#\d+$/)
		assert.equal(byId[ids.grp].depth, 0)
		assert.equal(byId[ids.grp].topLevel, true)

		// computed world box — real numbers, not the zeros an unread field would leave
		assert.ok(card.boundingBox.width > 0 && card.boundingBox.height > 0, JSON.stringify(card.boundingBox))
		assert.ok(Number.isFinite(card.pivot.x) && Number.isFinite(card.pivot.y))
		// Both coordinate spaces are explicit, and the pivot is located inside the
		// measured box rather than left for the caller to infer.
		for (const box of [card.boundingBox, card.worldBoundingBox, card.compBoundingBox]) {
			assert.ok(box, 'expected a measured box')
			assert.ok(Number.isFinite(box.pivotX) && Number.isFinite(box.pivotY), JSON.stringify(box))
			assert.ok(box.pivotX >= 0 && box.pivotX <= box.width, JSON.stringify(box))
			assert.ok(box.pivotY >= 0 && box.pivotY <= box.height, JSON.stringify(box))
			assert.equal(box.centre.x, box.x + box.width / 2)
			assert.equal(box.centre.y, box.y + box.height / 2)
		}
		// Visibility and hierarchy are fields, not conventions.
		assert.equal(card.visible, true)
		assert.equal(card.hidden, false)
		assert.equal(card.parent, ids.grp)
		assert.equal(card.parentName, 'beat 02')
		assert.deepEqual(card.deformers, [])
		assert.equal(card.childCount, 0)
		const dot = byId[ids.plain]
		assert.ok(dot.boundingBox.width > 0, JSON.stringify(dot.boundingBox))

		// evaluated at t=12, not the static default
		assert.equal(card.attrs['position.x'], 100)
		assert.equal(card.attrs['position.y'], -50)
		assert.ok(Object.keys(card.attrs).includes('rotation'))

		// driven? the oscillator owns rotation, so this is a rig not a baked value
		assert.deepEqual(card.connected, [{ attrPath: 'rotation', from: `${ids.osc}.id` }])

		// in/out frames come back for every layer
		for (const entry of envelope.layers) {
			assert.equal(typeof entry.inFrame, 'number')
			assert.equal(typeof entry.outFrame, 'number')
		}
	})
})

test('readback attributes are bounded and explicit', async () => {
	await withScene(async (handle, ids) => {
		await postJson(handle, '/post', { type: 'state', seq: 'a', attrs: ['position.x'] })
		const envelope = await getJson(handle)
		assert.ok(envelope.layers.some((entry) => entry.attrs['position.x'] !== undefined))
		for (const entry of envelope.layers) {
			assert.deepEqual(Object.keys(entry.attrs), entry.attrs['position.x'] === undefined ? [] : ['position.x'])
		}
		// asking for a path the layer does not expose is recorded, not fatal
		await postJson(handle, '/post', { type: 'state', seq: 'b', attrs: ['generator.dimensions', 'not.real'] })
		const second = await getJson(handle)
		assert.equal(second.ok, true)
		const card = second.layers.find((entry) => entry.id === ids.card)
		assert.ok(Array.isArray(card.attrs['generator.dimensions']))
		assert.ok(card.unreadable.includes('not.real'), JSON.stringify(card.unreadable))
		// declared attribute names, when asked for
		await postJson(handle, '/post', { type: 'state', seq: 'c', attributes: true, limit: 1 })
		const third = await getJson(handle)
		assert.ok(third.layers[0].attributeNames.length > 0)
		assert.ok(third.layers[0].attributeNames.includes('position.x'))
	})
})

test('pagination truncates cleanly and resumes at nextOffset', async () => {
	await withScene(async (handle) => {
		await postJson(handle, '/post', { type: 'state', seq: 'p1', limit: 2 })
		const first = await getJson(handle)
		assert.equal(first.ok, true)
		assert.equal(first.returned, 2)
		assert.equal(first.truncated, true)
		assert.equal(first.nextOffset, 2)

		await postJson(handle, '/post', { type: 'state', seq: 'p2', limit: 2, offset: 2 })
		const second = await getJson(handle)
		assert.equal(second.truncated, false, 'the final slice is complete, not truncated')
		assert.equal(second.nextOffset, -1)
		// walking the pages yields exactly the whole layer list, once each
		await postJson(handle, '/post', { type: 'state', seq: 'all' })
		const single = await getJson(handle)
		assert.equal(single.total, 4)
		const collected = []
		for (let offset = 0; offset < single.total; offset += 1) {
			await postJson(handle, '/post', { type: 'state', seq: `w${offset}`, limit: 1, offset })
			const page = await getJson(handle)
			assert.equal(page.returned, 1)
			collected.push(page.layers[0].id)
		}
		assert.deepEqual(collected, single.layers.map((entry) => entry.id))
		// out-of-range offset is an empty page, not an error
		await postJson(handle, '/post', { type: 'state', seq: 'past', offset: 99 })
		const past = await getJson(handle)
		assert.equal(past.ok, true)
		assert.equal(past.returned, 0)
		assert.equal(past.layers.length, 0)
	})
})

test('layers and state share one handler and one envelope', async () => {
	await withScene(async (handle) => {
		await postJson(handle, '/post', { type: 'state', seq: 'x', frame: 6 })
		const state = await getJson(handle)
		await postJson(handle, '/post', { type: 'layers', seq: 'x', frame: 6 })
		const layers = await getJson(handle)
		assert.equal(layers.kind, 'layers')
		// the discriminator is the only difference: same walk, same numbers
		const a = comparable(state)
		const b = comparable(layers)
		a.kind = b.kind = 'state'
		assert.deepEqual(a, b)
	})
})

test('path-shaped routes answer with the same envelope as the type-shaped request', async () => {
	await withScene(async (handle) => {
		await postJson(handle, '/post', { type: 'state', seq: 'same', frame: 12, attrs: ['position.x', 'rotation'] })
		const viaType = comparable(await getJson(handle))
		const viaPath = comparable(await getJson(handle, '/state?seq=same&frame=12&attrs=position.x,rotation'))
		assert.deepEqual(viaPath, viaType)
	})
})

test('GET /layers and POST /state both work, HEAD answers without a body', async () => {
	await withScene(async (handle, ids) => {
		const layers = await (await fetch(`http://127.0.0.1:${handle.port}/layers?frame=0&limit=2`)).json()
		assert.equal(layers.kind, 'layers')
		assert.equal(layers.returned, 2)

		const posted = await postJson(handle, '/state', { frame: 24, attrs: ['position.x'] })
		assert.equal(posted.status, 200)
		assert.equal(posted.body.kind, 'state')
		const card = posted.body.layers.find((entry) => entry.id === ids.card)
		assert.equal(card.attrs['position.x'], 200)

		const head = await fetch(`http://127.0.0.1:${handle.port}/state`, { method: 'HEAD' })
		assert.equal(head.status, 200)
		assert.equal(head.headers.get('content-type'), 'application/json')
		assert.equal((await head.arrayBuffer()).byteLength, 0)
	})
})

test('the playhead is moved to read values and restored afterwards', async () => {
	await withScene(async (handle) => {
		await postJson(handle, '/post', { type: 'script', seq: 'f0', code: 'api.setFrame(7); return api.getFrame();' })
		assert.equal((await getJson(handle)).result, 7)
		const read = await getJson(handle, '/state?frame=19&limit=1')
		assert.equal(read.frame, 19, 'the readback reports the frame it evaluated at')
		assert.equal(read.returned, 1)
		const after = await postJson(handle, '/post', { type: 'script', seq: 'f1', code: 'return api.getFrame();' })
		assert.equal(after.body.ok, true)
		assert.equal((await getJson(handle)).result, 7, 'the caller playhead was left where it was')
	})
})

test('snapshot renders, verifies the file in-call and reports the scene digest', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-snap-'))
	const handle = await startMockServer({ port: 0 })
	try {
		await postJson(handle, '/post', { type: 'script', seq: 'b', code: SCENE_SCRIPT })
		await getJson(handle)
		await postJson(handle, '/post', { type: 'script', seq: 'f', code: 'api.setFrame(3); return true;' })
		await getJson(handle)
		const before = Date.now()
		const { body: ack } = await postJson(handle, '/post', { type: 'snapshot', seq: 'sn', frame: 12, outDir: dir, fileName: 'probe', scale: 25 })
		assert.equal(ack.ok, true)
		const envelope = await getJson(handle)
		assert.equal(envelope.kind, 'snapshot')
		assert.equal(envelope.seq, 'sn')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.frame, 12)
		assert.equal(envelope.restoredFrame, 3)
		assert.equal(envelope.scale, 25)
		assert.equal(envelope.error, null)
		// scene URI: forward slashes only, even on Windows
		assert.doesNotMatch(envelope.file, /\\/)
		assert.ok(envelope.file.endsWith('/probe.png'), envelope.file)
		assert.equal(envelope.exists, true)
		assert.ok(envelope.sizeBytes > 0)
		assert.equal(envelope.sizeBytes, fs.statSync(path.join(dir, 'probe.png')).size)
		// exact render time, so a stale file from an earlier pass cannot be mistaken
		// for this one
		assert.ok(envelope.renderedAt >= before - 1 && envelope.renderedAt <= Date.now() + 1000)
		assert.equal(new Date(envelope.renderedAtIso).getTime(), envelope.renderedAt)
		assert.match(envelope.frameHash, /^[0-9a-f]{16}$/)
		// the mock is real Node, so it can also hash the bytes
		assert.match(envelope.contentHash, /^[0-9a-f]{64}$/)
		// and the playhead went back where it was
		const frame = await postJson(handle, '/post', { type: 'script', seq: 'gf', code: 'return api.getFrame();' })
		assert.equal(frame.body.ok, true)
		assert.equal((await getJson(handle)).result, 3)

		// same comp + same frame ⇒ same digest; a different frame ⇒ a different one
		const again = await getJson(handle, `/frame?frame=12&outDir=${encodeURIComponent(dir)}&fileName=probe&scale=25&inline=0`)
		assert.equal(again.frameHash, envelope.frameHash)
		const later = await getJson(handle, `/frame?frame=18&outDir=${encodeURIComponent(dir)}&fileName=probe18&scale=25&inline=0`)
		assert.notEqual(later.frameHash, envelope.frameHash)
	} finally {
		await handle.close()
		removeTreeSync(dir)
	}
})

test('GET /frame hands back decodable pixels so nobody polls the disk', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-frame-'))
	const handle = await startMockServer({ port: 0 })
	try {
		await postJson(handle, '/post', { type: 'script', seq: 'b', code: SCENE_SCRIPT })
		await getJson(handle)
		const envelope = await getJson(handle, `/frame?frame=0&outDir=${encodeURIComponent(dir)}&fileName=f0&scale=25`)
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.width, 480)
		assert.equal(envelope.height, 270)
		const png = Buffer.from(String(envelope.pngBase64), 'base64')
		assert.deepEqual([...png.subarray(0, 4)], PNG_MAGIC)
		// inline=0 keeps the answer small
		const noPixels = await getJson(handle, `/snapshot?frame=0&outDir=${encodeURIComponent(dir)}&fileName=f0b&inline=0`)
		assert.equal(noPixels.ok, true)
		assert.equal(noPixels.pngBase64, undefined)
		// POST /snapshot with a JSON body reaches the same handler
		const posted = await postJson(handle, '/snapshot', { frame: 6, outDir: dir, fileName: 'posted', scale: 25, inline: false })
		assert.equal(posted.status, 200)
		assert.equal(posted.body.ok, true, JSON.stringify(posted.body.error))
		assert.ok(posted.body.file.endsWith('/posted.png'))
	} finally {
		await handle.close()
		removeTreeSync(dir)
	}
})

test('snapshot-batch renders sparse frames with boxes and hashes in one roundtrip', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-batch-'))
	const handle = await startMockServer({ port: 0 })
	try {
		const built = await postJson(handle, '/post', { type: 'script', seq: 'build', code: SCENE_SCRIPT })
		assert.equal(built.body.ok, true)
		const ids = await getJson(handle)
		await postJson(handle, '/post', { type: 'script', seq: 'frame', code: 'api.setFrame(3); return true;' })
		await getJson(handle)

		const before = Date.now()
		const ack = await postJson(handle, '/post', {
			type: 'snapshot-batch',
			seq: 'sb-1',
			frames: [24, 0, 12, 12],
			outDir: dir,
			fileName: 'beats',
			scale: 25,
			attrs: ['position.x'],
		})
		assert.equal(ack.body.ok, true)
		const envelope = await getJson(handle)
		assert.equal(envelope.kind, 'snapshot-batch')
		assert.equal(envelope.seq, 'sb-1')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.errors))
		// deduped and sorted, so a caller can index frames positionally
		assert.deepEqual(envelope.frames.map((entry) => entry.frame), [0, 12, 24])
		assert.deepEqual(envelope.errors, [])
		assert.equal(envelope.requested, 3)
		assert.equal(envelope.rendered, 3)
		assert.equal(envelope.scale, 25)
		assert.equal(envelope.restoredFrame, 3)
		assert.equal(typeof envelope.compId, 'string')

		for (const entry of envelope.frames) {
			assert.equal(entry.exists, true)
			assert.ok(entry.sizeBytes > 0)
			assert.equal(entry.sizeBytes, fs.statSync(entry.file).size)
			assert.ok(entry.renderedAt >= before - 1 && entry.renderedAt <= Date.now() + 1000)
			assert.match(entry.frameHash, /^[0-9a-f]{16}$/)
			assert.match(entry.contentHash, /^[0-9a-f]{64}$/)
			// scene URI: forward slashes only, even when the temp dir is a Windows path
			assert.doesNotMatch(entry.file, /\\/)
			assert.ok(entry.file.endsWith(`/beats-${String(entry.frame).padStart(6, '0')}.png`), entry.file)
			// the mock can hand back pixels; the live host reports paths only
			assert.equal(entry.width, 480)
			assert.equal(entry.height, 270)
			const png = Buffer.from(String(entry.pngBase64), 'base64')
			assert.deepEqual([...png.subarray(0, 4)], PNG_MAGIC)

			const byId = Object.fromEntries(entry.layers.map((layer) => [layer.id, layer]))
			const card = byId[ids.result.card]
			assert.ok(card, `card missing at frame ${entry.frame}: ${Object.keys(byId)}`)
			assert.equal(card.type, 'basicShape')
			assert.equal(card.visible, true)
			assert.ok(Number.isFinite(card.bbox.x) && Number.isFinite(card.bbox.y))
			assert.ok(card.bbox.width > 0 && card.bbox.height > 0)
			assert.ok(card.bbox.pivotX >= 0 && card.bbox.pivotX <= card.bbox.width, JSON.stringify(card.bbox))
			assert.ok(card.bbox.pivotY >= 0 && card.bbox.pivotY <= card.bbox.height, JSON.stringify(card.bbox))
			assert.equal(card.bbox.centre.x, card.bbox.x + card.bbox.width / 2)
			// attributes are evaluated at this frame, not at the playhead
			assert.equal(card.attrs['position.x'], (entry.frame / 24) * 200)
		}
		// the whole point of a batch: three frames, three digests
		const hashes = new Set(envelope.frames.map((entry) => entry.frameHash))
		assert.equal(hashes.size, 3)
		assert.notEqual(envelope.frames[0].contentHash, envelope.frames[1].contentHash)

		// the caller playhead was left exactly where it was
		await postJson(handle, '/post', { type: 'script', seq: 'gf', code: 'return api.getFrame();' })
		assert.equal((await getJson(handle)).result, 3)

		// path-shaped GET answers with the same envelope and can skip pixels
		const viaPath = await getJson(
			handle,
			`/snapshot-batch?frames=12,0&outDir=${encodeURIComponent(dir)}&fileName=beats2&scale=25&attrs=position.x&inline=0`,
		)
		assert.equal(viaPath.kind, 'snapshot-batch')
		assert.equal(viaPath.ok, true, JSON.stringify(viaPath.errors))
		assert.deepEqual(viaPath.frames.map((entry) => entry.frame), [0, 12])
		assert.equal(viaPath.frames[0].pngBase64, undefined)
		assert.ok(viaPath.frames[1].file.endsWith('/beats2-000012.png'))

		// path-shaped POST merges its JSON body over the query string
		const posted = await postJson(handle, `/snapshot-batch?outDir=${encodeURIComponent(dir)}`, {
			frames: [6],
			fileName: 'posted-batch',
			scale: 25,
			inline: false,
		})
		assert.equal(posted.status, 200)
		assert.equal(posted.body.kind, 'snapshot-batch')
		assert.equal(posted.body.ok, true, JSON.stringify(posted.body.errors))
		assert.deepEqual(posted.body.frames.map((entry) => entry.frame), [6])
		assert.ok(posted.body.frames[0].file.endsWith('/posted-batch-000006.png'))

		// hidden layers are omitted by default and reported as invisible on request
		await postJson(handle, '/post', {
			type: 'script',
			seq: 'hide',
			code: `api.set(${JSON.stringify(ids.result.plain)}, { hidden: true }); return true;`,
		})
		assert.equal((await getJson(handle)).ok, true)
		const withoutHidden = await getJson(handle, `/snapshot-batch?frames=0&outDir=${encodeURIComponent(dir)}&fileName=visible&scale=25&inline=0`)
		assert.equal(withoutHidden.ok, true)
		assert.equal(
			withoutHidden.frames[0].layers.some((layer) => layer.id === ids.result.plain),
			false,
			JSON.stringify(withoutHidden.frames[0].layers.map((layer) => layer.id)),
		)
		const withHidden = await getJson(
			handle,
			`/snapshot-batch?frames=0&outDir=${encodeURIComponent(dir)}&fileName=hidden&scale=25&includeHidden=1&inline=0`,
		)
		const hidden = withHidden.frames[0].layers.find((layer) => layer.id === ids.result.plain)
		assert.ok(hidden, 'includeHidden must include invisible layers')
		assert.equal(hidden.visible, false)
	} finally {
		await handle.close()
		removeTreeSync(dir)
	}
})

test('snapshot-batch rejects an empty frame list deterministically', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const ack = await postJson(handle, '/post', { type: 'snapshot-batch', seq: 'empty', frames: [], mgCall: '_mg.patch(card)' })
		assert.equal(ack.body.ok, true)
		const envelope = await getJson(handle)
		assert.equal(envelope.ok, false)
		assert.equal(envelope.kind, 'snapshot-batch')
		assert.equal(envelope.code, 'STALLION_NO_FRAME')
		assert.equal(envelope.seq, 'empty')
		assert.equal(envelope.mgCall, '_mg.patch(card)')
		assert.match(envelope.error, /frames/)

		const viaPath = await getJson(handle, '/snapshot-batch?frames=abc')
		assert.equal(viaPath.ok, false)
		assert.equal(viaPath.kind, 'snapshot-batch')
		assert.equal(viaPath.code, 'STALLION_NO_FRAME')
	} finally {
		await handle.close()
	}
})

test('snapshot failures are deterministic error envelopes', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const noFrame = await postJson(handle, '/post', { type: 'snapshot', seq: 'bad', mgCall: '_mg.patch(card)' })
		assert.equal(noFrame.body.ok, true) // the ack says the request was accepted
		const envelope = await getJson(handle)
		assert.equal(envelope.ok, false)
		assert.equal(envelope.kind, 'snapshot')
		assert.equal(envelope.code, 'STALLION_NO_FRAME')
		assert.equal(envelope.seq, 'bad')
		assert.equal(envelope.mgCall, '_mg.patch(card)')
		assert.match(envelope.error, /numeric .frame/)
		// optional keys stay absent rather than arriving as null
		assert.equal('layerId' in envelope, false)
		assert.equal('attrPath' in envelope, false)

		const badPath = await getJson(handle, '/snapshot?frame=1&fileName=' + encodeURIComponent('../../evil:name'))
		assert.equal(badPath.ok, true)
		// separators and reserved characters cannot survive into the artifact name
		assert.equal(badPath.fileName, '.._.._evil_name')
		assert.doesNotMatch(badPath.fileName, /[\\/:*?"<>|]/)
		assert.doesNotMatch(badPath.file, /\.\.[\\/]/)
	} finally {
		await handle.close()
	}
})

test('introspection routes obey token auth', async () => {
	const handle = await startMockServer({ port: 0, token: 'sekrit' })
	try {
		for (const route of ['/state', '/layers', '/frame']) {
			const response = await fetch(`http://127.0.0.1:${handle.port}${route}`)
			assert.equal(response.status, 401, route)
		}
		const ok = await fetch(`http://127.0.0.1:${handle.port}/state`, { headers: { authorization: 'Bearer sekrit' } })
		assert.equal(ok.status, 200)
	} finally {
		await handle.close()
	}
})
