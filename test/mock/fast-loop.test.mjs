/**
 * Fast-loop endpoint contract tests — run with `npm test`.
 *
 * Covers the three refinement-loop kinds added in v0.11.0:
 *
 *   - `batch_inspect`  — geometry-only multi-frame readback matrix
 *   - `export_comp_rig_overrides` — procedural/visual knob readback for reverse
 *     preset sync (spring physics, stagger, palette, font sizes)
 *   - `checkpoint`     — scene state serialization under a snapshotId
 *   - `rollback`       — millisecond restore from memory or the temp-file copy
 *   - `render_frame_fast` — downscaled temp-dir render with inline base64 (mock)
 *
 * Like introspect.test.mjs, these run the exact runtime *scripts* the live
 * bridge hands to `api.exec`, through the mock's vm sandbox, over both the
 * `type`-shaped POST /post surface and the mock-only literal paths.
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

/** A card with position keyframed 0 → 200 across frames 0..24, plus a static dot. */
const SCENE_SCRIPT = `
	var card = api.primitive('rectangle', 'card spring');
	api.set(card, { 'generator.dimensions': [200, 100], position: [0, -50] });
	api.keyframe(card, 0, { 'position.x': 0 });
	api.keyframe(card, 24, { 'position.x': 200 });
	var dot = api.primitive('ellipse', 'dot');
	api.set(dot, { 'generator.dimensions': [40, 40], position: [300, 100] });
	return { card: card, dot: dot };
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

test('batch_inspect returns the comp matrix over POST /post with the playhead restored', async () => {
	await withScene(async (handle, built) => {
		await postJson(handle, '/post', {
			type: 'batch_inspect',
			seq: 'bi1',
			frames: [0, 24],
			layerIds: [built.card, built.dot],
			attributes: ['position.x', 'opacity'],
		})
		const envelope = await getJson(handle)
		assert.equal(envelope.kind, 'batch_inspect')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.compId, handle.scene.activeComp().id)
		assert.equal(envelope.compFrameRate, 24)
		assert.deepEqual(envelope.compResolution, [1920, 1080])
		assert.deepEqual(envelope.frames, [0, 24])
		// The short-form box: w/h plus the centroid the solver keys against.
		const at0 = envelope.timeline['0'][built.card]
		assert.ok(Math.abs(at0.bbox.cx - 0) < 1e-6, `frame 0 cx ${at0.bbox.cx}`)
		assert.equal(at0.bbox.w, 200)
		assert.equal(at0.bbox.h, 100)
		assert.equal(at0.attrs['position.x'], 0)
		const at24 = envelope.timeline['24'][built.card]
		assert.ok(Math.abs(at24.bbox.cx - 200) < 1e-6, `frame 24 cx ${at24.bbox.cx}`)
		assert.equal(at24.attrs['position.x'], 200)
		// The static dot measures identically on both frames.
		assert.equal(envelope.timeline['0'][built.dot].bbox.cx, envelope.timeline['24'][built.dot].bbox.cx)
		// The playhead ends where it started.
		assert.equal(envelope.restoredFrame, 0)
		assert.equal(handle.scene.frame, 0)
	})
})

test('export_comp_rig_overrides returns procedural/visual knobs and keeps geometry out', async () => {
	await withScene(async (handle, built) => {
		const rigScript = `
			var dup = api.create('duplicator', 'items stagger');
			api.set(dup, { count: 7, staggerOffset: 3 });
			var label = api.create('textShape', 'headline');
			api.set(label, { text: 'Quarterly', fontSize: 64, 'material.materialColor': '#FF0044' });
			var card = ${JSON.stringify(built.card)};
			api.set(card, { 'material.materialColor': '#112233' });
			return { dup: dup, label: label, card: card };
		`
		const { body: ack } = await postJson(handle, '/post', { type: 'script', seq: 'rig-build', code: rigScript })
		assert.equal(ack.ok, true)
		const rig = (await getJson(handle)).result
		await postJson(handle, '/post', { type: 'export_comp_rig_overrides', seq: 'rig1', layerIds: [rig.dup, rig.label, rig.card] })
		const envelope = await getJson(handle)
		assert.equal(envelope.kind, 'export_comp_rig_overrides')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		const byId = new Map(envelope.layers.map(entry => [entry.id, entry]))
		const dup = byId.get(rig.dup)
		assert.equal(dup.attrs.count, 7)
		assert.equal(dup.attrs.staggerOffset, 3)
		const label = byId.get(rig.label)
		assert.equal(label.attrs.fontSize, 64)
		assert.equal(label.attrs['material.materialColor'], '#FF0044')
		const card = byId.get(rig.card)
		assert.equal(card.attrs['material.materialColor'], '#112233')
		// Geometry is Stage 4's contract, not this readback's.
		assert.equal(card.attrs.position, undefined)
		assert.equal(card.attrs.scale, undefined)
		assert.ok(card.animated.includes('position.x'))
		assert.deepEqual(envelope.compResolution, [1920, 1080])
		assert.equal(envelope.frame, handle.scene.frame)
		// Literal path answers the identical layer documents.
		const { body: direct } = await postJson(handle, '/export_comp_rig_overrides', { seq: 'rig2', layerIds: [rig.dup, rig.label, rig.card] })
		assert.deepEqual(direct.layers, envelope.layers)
	})
})

test('batch_inspect via the literal path answers the identical envelope', async () => {
	await withScene(async (handle, built) => {
		const { body: direct } = await postJson(handle, '/batch_inspect', { seq: 'bi2', frames: [0, 24], layerIds: [built.card] })
		assert.equal(direct.kind, 'batch_inspect')
		assert.equal(direct.ok, true)
		await postJson(handle, '/post', { type: 'batch_inspect', seq: 'bi3', frames: [0, 24], layerIds: [built.card] })
		const viaType = await getJson(handle)
		assert.deepEqual(direct.timeline, viaType.timeline)
	})
})

test('batch_inspect rejects an empty frames array and omits unknown layer ids from the matrix', async () => {
	await withScene(async (handle, built) => {
		await postJson(handle, '/post', { type: 'batch_inspect', seq: 'bi4', frames: [] })
		const bad = await getJson(handle)
		assert.equal(bad.ok, false)
		assert.equal(bad.code, 'STALLION_BAD_REQUEST')
		const { body: partial } = await postJson(handle, '/batch_inspect', { seq: 'bi5', frames: [0], layerIds: [built.card, 'ghost#9'] })
		assert.equal(partial.ok, true)
		assert.deepEqual(partial.unknownLayerIds, ['ghost#9'])
		assert.ok(partial.timeline['0'][built.card])
		assert.equal(partial.timeline['0']['ghost#9'], undefined)
	})
})

test('checkpoint + rollback restore values, keyframes and the playhead in one round trip', async () => {
	await withScene(async (handle, built) => {
		await postJson(handle, '/post', { type: 'checkpoint', seq: 'cp1', snapshotId: 'beat-02' })
		const checkpoint = await getJson(handle)
		assert.equal(checkpoint.kind, 'checkpoint')
		assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint.error))
		assert.equal(checkpoint.snapshotId, 'beat-02')
		assert.equal(checkpoint.state.version, 1)
		assert.ok(checkpoint.state.layers.length >= 2)
		const recorded = checkpoint.state.layers.find((layer) => layer.id === built.card)
		assert.equal(recorded.keyframes['position.x'].length, 2)
		// The fast temp copy exists on disk at the reported path.
		assert.ok(checkpoint.tmpFile, 'checkpoint reports a tmpFile')
		assert.ok(fs.existsSync(checkpoint.tmpFile))

		// A rejected mutation: yank the card away, retime it and add a stray layer.
		await postJson(handle, '/post', {
			type: 'script',
			seq: 'mutate',
			code: `
				api.set(${JSON.stringify(built.card)}, { position: [999, 999] });
				api.keyframe(${JSON.stringify(built.card)}, 12, { 'position.x': 555 });
				api.primitive('rectangle', 'stray');
				api.setFrame(17);
				return 'mutated';
			`,
		})
		await getJson(handle)

		await postJson(handle, '/post', { type: 'rollback', seq: 'rb1', snapshotId: 'beat-02' })
		const rollback = await getJson(handle)
		assert.equal(rollback.kind, 'rollback')
		assert.equal(rollback.ok, true, JSON.stringify(rollback.error))
		assert.equal(rollback.restoredFrame, 0)
		assert.equal(rollback.deleted.length, 1, 'the stray layer is removed')
		assert.equal(rollback.keyframesRestored, 2, 'the extra keyframe is gone and both originals are back')

		// Verify the restore by re-measuring the scene.
		const { body: verify } = await postJson(handle, '/batch_inspect', { seq: 'v1', frames: [0, 12, 24], layerIds: [built.card] })
		assert.equal(verify.ok, true)
		assert.ok(Math.abs(verify.timeline['0'][built.card].bbox.cx - 0) < 1e-6)
		assert.ok(Math.abs(verify.timeline['24'][built.card].bbox.cx - 200) < 1e-6)
		// Frame 12 had a bogus keyframe (555) before the rollback; the restored
		// animation interpolates instead.
		const cx12 = verify.timeline['12'][built.card].bbox.cx
		assert.ok(Math.abs(cx12 - 100) < 1e-6, `frame 12 cx ${cx12} should interpolate to 100`)
	})
})

test('rollback resolves from the temp-file copy after the in-memory store is gone', async () => {
	const tmpFile = path.join(os.tmpdir(), `stallion-checkpoint-rc-${Date.now().toString(36)}.cv`)
	try {
		const first = await startMockServer({ port: 0 })
		await postJson(first, '/post', { type: 'script', seq: 'b', code: SCENE_SCRIPT })
		await getJson(first)
		await postJson(first, '/post', { type: 'checkpoint', seq: 'cp', snapshotId: 'rc-1' })
		const checkpoint = await getJson(first)
		assert.ok(fs.existsSync(checkpoint.tmpFile))
		fs.copyFileSync(checkpoint.tmpFile, tmpFile)
		await first.close()

		// A brand-new server has an empty in-memory map; the deterministic temp
		// path is what survives. Move the copy into the place the rollback looks.
		const target = path.join(os.tmpdir(), 'stallion-mock-tmp', 'stallion-checkpoint-rc-1.cv')
		fs.mkdirSync(path.dirname(target), { recursive: true })
		fs.copyFileSync(tmpFile, target)
		const second = await startMockServer({ port: 0 })
		try {
			// The layer ids in the state document do not exist in this fresh scene,
			// so the rollback re-creates them — the documented structural path.
			await postJson(second, '/post', { type: 'rollback', seq: 'rb', snapshotId: 'rc-1' })
			const rollback = await getJson(second)
			assert.equal(rollback.kind, 'rollback')
			assert.equal(rollback.ok, true, JSON.stringify(rollback.error))
			assert.ok(rollback.recreated.length >= 2, JSON.stringify(rollback.recreated))
			assert.equal(rollback.restoredFrame, 0)
		} finally {
			await second.close()
		}
	} finally {
		removeTreeSync(tmpFile)
		removeTreeSync(path.join(os.tmpdir(), 'stallion-mock-tmp', 'stallion-checkpoint-rc-1.cv'))
	}
})

test('rollback with an unknown snapshotId is a deterministic error envelope', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const { body: direct } = await postJson(handle, '/rollback', { seq: 'rb-x', snapshotId: 'nope' })
		assert.equal(direct.ok, false)
		assert.equal(direct.code, 'STALLION_UNKNOWN_SNAPSHOT')
		await postJson(handle, '/post', { type: 'rollback', seq: 'rb-y', snapshotId: 'nope' })
		const viaType = await getJson(handle)
		assert.equal(viaType.ok, false)
		assert.equal(viaType.code, 'STALLION_UNKNOWN_SNAPSHOT')
	} finally {
		await handle.close()
	}
})

test('rollback accepts an inline state document without a prior checkpoint', async () => {
	const handle = await startMockServer({ port: 0 })
	try {
		const state = {
			version: 1,
			compId: null,
			frame: 5,
			layers: [
				{
					id: 'inline#1',
					type: 'rectangle',
					name: 'inline card',
					parent: null,
					inFrame: 0,
					outFrame: 100,
					hidden: false,
					attrs: { 'generator.dimensions': [120, 60], position: [10, 20] },
					animated: [],
					keyframes: {},
					connections: [],
				},
			],
		}
		const { body: envelope } = await postJson(handle, '/rollback', { seq: 'rb-inline', state })
		assert.equal(envelope.kind, 'rollback')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.recreated.length, 1)
		assert.equal(envelope.restoredFrame, 5)
	} finally {
		await handle.close()
	}
})

test('render_frame_fast writes a downscaled temp PNG and inlines base64 on the mock', async () => {
	await withScene(async (handle, built) => {
		const { body: envelope } = await postJson(handle, '/render_frame_fast', {
			seq: 'ff1',
			frame: 12,
			scaleFactor: 0.5,
		})
		assert.equal(envelope.kind, 'render_frame_fast')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		assert.equal(envelope.scaleFactor, 0.5)
		assert.equal(envelope.scale, 50)
		assert.ok(
			envelope.file.replace(/\\/g, '/').startsWith(`${os.tmpdir().replace(/\\/g, '/')}/stallion-mock-tmp`),
			`temp path: ${envelope.file}`,
		)
		const bytes = fs.readFileSync(envelope.file)
		assert.equal(bytes.length, envelope.sizeBytes)
		// contentHash is over the artifact the file names, byte for byte.
		const { createHash } = await import('node:crypto')
		assert.equal(envelope.contentHash, createHash('sha256').update(bytes).digest('hex'))
		// The inline buffer is a real PNG at the downscaled resolution (the mock
		// encodes it from the same RGBA sidecar its snapshot inline uses).
		const inline = Buffer.from(envelope.pngBase64, 'base64')
		for (let i = 0; i < PNG_MAGIC.length; i++) assert.equal(inline[i], PNG_MAGIC[i])
		assert.equal(envelope.width, 960)
		assert.equal(envelope.height, 540)
		// The playhead is restored after the render.
		assert.equal(handle.scene.frame, 0)

		// inline:false names the file only; the round trip skips the buffer.
		const { body: fileOnly } = await postJson(handle, '/render_frame_fast', { seq: 'ff2', frame: 12, scaleFactor: 0.5, inline: false })
		assert.equal(fileOnly.ok, true)
		assert.equal(fileOnly.pngBase64, undefined)
		assert.ok(fileOnly.exists)
	})
})

test('render_frame_fast rejects a missing frame and honours explicit outDir', async () => {
	const outDir = path.join(os.tmpdir(), `stallion-fast-test-${Date.now().toString(36)}`)
	try {
		const handle = await startMockServer({ port: 0 })
		try {
			await postJson(handle, '/post', { type: 'script', seq: 'b', code: SCENE_SCRIPT })
			await getJson(handle)
			const { body: bad } = await postJson(handle, '/render_frame_fast', { seq: 'ff3' })
			assert.equal(bad.ok, false)
			assert.equal(bad.code, 'STALLION_NO_FRAME')
			const { body: custom } = await postJson(handle, '/render_frame_fast', { seq: 'ff4', frame: 0, scaleFactor: 0.25, outDir })
			assert.equal(custom.ok, true, JSON.stringify(custom.error))
			assert.ok(fs.existsSync(custom.file), custom.file)
			assert.ok(custom.file.replace(/\\/g, '/').startsWith(outDir.replace(/\\/g, '/')))
		} finally {
			await handle.close()
		}
	} finally {
		removeTreeSync(outDir)
	}
})
