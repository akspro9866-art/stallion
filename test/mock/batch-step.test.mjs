/**
 * /batch-step contract tests — run with `node --test test/*.test.mjs`.
 *
 * The batch-step endpoint is the zero-slop cloning surface: one POST applies a
 * script or declarative `_mg` manifest, steps sampled frames, optionally
 * renders PNGs and reports the compact DOM TSV. These tests prove the wire
 * contract on the mock bridge — the same `batchStepScript` source the live
 * bridge executes through `api.exec` — and that the preloaded `_mg` runtime is
 * reachable from `helpers: true` scripts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startMockServer } from '../../dist/stallion-mock.mjs'

async function withServer(fn, options = {}) {
	const handle = await startMockServer({ port: 0, ...options })
	handle.post = async (payload) => {
		const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		})
		assert.equal(response.status, 200)
		return response.json()
	}
	handle.get = async () => (await fetch(`http://127.0.0.1:${handle.port}/get`)).json()
	try {
		return await fn(handle)
	} finally {
		await handle.close()
	}
}

/** POST /post as `type: "batch-step"` and return the reshaped /get envelope. */
async function batchStep(handle, payload, { viaPath = false } = {}) {
	const seq = `bs-${Math.random().toString(36).slice(2)}`
	const url = viaPath === true ? `http://127.0.0.1:${handle.port}/batch-step` : `http://127.0.0.1:${handle.port}/post`
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(viaPath === true ? { seq, ...payload } : { type: 'batch-step', seq, ...payload }),
	})
	assert.equal(response.status, 200)
	const ack = await response.json()
	if (viaPath === true) return ack
	assert.equal(ack.ok, true, 'POST /post must ack the batch-step enqueue')
	return await handle.get()
}

test('batch-step heartbeat advertises the mg runtime', async () => {
	await withServer(async (handle) => {
		const status = await handle.get()
		assert.equal(status.capabilities.mgRuntime, true)
		assert.ok(status.capabilities.introspect.includes('batch-step'))
	})
})

test('batch-step executes a script and samples frame geometry', async () => {
	await withServer(async (handle) => {
		const envelope = await batchStep(handle, {
			script: `
				var card = api.primitive('rectangle', 'card');
				api.set(card, { 'generator.dimensions': [200, 100], position: [0, 0] });
				api.keyframe(card, 0, { 'position.x': 0 });
				api.keyframe(card, 10, { 'position.x': 100 });
				return { created: card };
			`,
			sampleFrames: [0, 5, 10],
		})
		assert.equal(envelope.kind, 'batch-step')
		assert.equal(envelope.ok, true, envelope.error ?? 'script must not fail')
		assert.equal(typeof envelope.executionTimeMs, 'number')
		// Interpolated geometry: position.x moves 0→100 over frames 0→10.
		const at0 = envelope.frames['0'].geometries.find((g) => g.name === 'card')
		const at5 = envelope.frames['5'].geometries.find((g) => g.name === 'card')
		const at10 = envelope.frames['10'].geometries.find((g) => g.name === 'card')
		assert.ok(at0 && at5 && at10, 'card must be measured at every sampled frame')
		assert.equal(at0.bbox.cx, 0)
		assert.equal(at10.bbox.cx, 100)
		assert.equal(at5.bbox.cx, 50)
		// bbox carries x/y/width/height + centroid per the contract.
		for (const key of ['x', 'y', 'width', 'height', 'cx', 'cy']) assert.equal(typeof at0.bbox[key], 'number')
		assert.equal(envelope.scriptResult.created, at0.layerId)
		// The playhead is restored.
		assert.equal(envelope.restoredFrame, 0)
	})
})

test('batch-step applies a declarative _mg manifest', async () => {
	await withServer(async (handle) => {
		const envelope = await batchStep(handle, {
			dslManifest: {
				comp: { width: 640, height: 360, fps: 30, endFrame: 60, bg: '#101418' },
				layers: [
					{ as: 'hero', kind: 'shape', shape: 'rectangle', name: 'Hero', attrs: { 'generator.dimensions': [300, 150], 'material.materialColor': '#10B981' } },
					{ as: 'title', kind: 'text', text: 'Refclone', size: 48, color: '#F8FAFC' },
				],
				ops: [
					{ op: 'keyframe', target: '$hero', frames: [{ frame: 0, attrs: { 'position.x': -200 } }, { frame: 30, attrs: { 'position.x': 0 } }], easing: [{ attr: 'position.x', easing: 'OvershootOut' }] },
					{ op: 'set', target: '$title', attrs: { opacity: 80 } },
					{ op: 'bogus', target: '$hero' },
				],
			},
			sampleFrames: [0, 30],
		})
		assert.equal(envelope.ok, true)
		const manifest = envelope.scriptResult
		assert.equal(manifest.ok, false, 'the bogus op must be reported, not swallowed')
		assert.ok(manifest.created.hero, 'hero alias resolves to a live layer id')
		assert.ok(manifest.created.title)
		assert.equal(manifest.ops.filter((op) => op.ok).length, 4, 'two creates + keyframe + set succeed')
		const failed = manifest.ops.find((op) => op.ok === false)
		assert.ok(failed && /unknown op/.test(failed.error), 'bogus op carries its error')
		const hero0 = envelope.frames['0'].geometries.find((g) => g.name === 'Hero')
		const hero30 = envelope.frames['30'].geometries.find((g) => g.name === 'Hero')
		assert.equal(hero0.bbox.cx, -200)
		assert.equal(hero30.bbox.cx, 0)
		// _mg.text names the layer after its text, not the alias handle.
		assert.ok(envelope.frames['0'].geometries.find((g) => g.name === 'Refclone'), 'text layer is measured alongside shapes')
		assert.ok(envelope.compactDomTsv.includes('Hero'))
	})
})

test('batch-step renders sampled frames when renderFrames is set', async () => {
	await withServer(async (handle) => {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-step-render-'))
		const envelope = await batchStep(handle, {
			script: `var s = api.primitive('ellipse', 'dot'); api.set(s, { 'generator.dimensions': [40, 40] });`,
			sampleFrames: [0, 3],
			renderFrames: true,
			renderOutputDir: outDir,
		})
		assert.equal(envelope.ok, true)
		assert.equal(envelope.rendered, 2)
		for (const frame of ['0', '3']) {
			const entry = envelope.frames[frame]
			assert.ok(entry.renderedPngPath, 'frame ' + frame + ' names its PNG')
			assert.match(entry.renderedPngPath, /frame_\d+\.png$/)
		}
	})
})

test('batch-step rejects payloads without script or dslManifest', async () => {
	await withServer(async (handle) => {
		const envelope = await batchStep(handle, { sampleFrames: [0] })
		assert.equal(envelope.ok, false)
		assert.equal(envelope.kind, 'batch-step')
		assert.match(envelope.error, /requires/)
	})
})

test('batch-step TSV is compact and line-per-layer', async () => {
	await withServer(async (handle) => {
		const envelope = await batchStep(handle, {
			dslManifest: {
				layers: [
					{ as: 'a', kind: 'shape', shape: 'rectangle', name: 'Alpha' },
					{ as: 'b', kind: 'shape', shape: 'ellipse', name: 'Beta' },
				],
				ops: [{ op: 'keyframe', target: '$a', frames: [{ frame: 0, attrs: { 'position.x': 0 } }, { frame: 12, attrs: { 'position.x': 90 } }] }],
			},
			sampleFrames: [12],
		})
		assert.equal(envelope.ok, true)
		const lines = envelope.compactDomTsv.split('\n')
		assert.ok(lines.length >= 3, 'header + one line per layer')
		assert.deepEqual(
			lines[0].split('\t'),
			['id', 'type', 'parent', 'name', 'x,y,w,h', 'animAttrs', 'connections'],
		)
		const alpha = lines.find((line) => line.includes('Alpha'))
		assert.ok(alpha, 'Alpha appears exactly once as a row')
		const cells = alpha.split('\t')
		assert.equal(cells[1], 'basicShape')
		assert.ok(/^-?[\d.]+,-?[\d.]+,100(\.0+)?,100(\.0+)?$/.test(cells[4]), 'bbox cell is x,y,w,h: ' + cells[4])
		assert.ok(cells[5].includes('position.x'), 'animated attribute listed as dirty')
	})
})

test('literal POST /batch-step route returns the identical envelope', async () => {
	// Two fresh scenes: the mock scene persists per server, so each route gets
	// its own server to keep the two envelopes comparable.
	const manifest = { layers: [{ as: 'solo', kind: 'shape', shape: 'rectangle', name: 'Solo' }], ops: [] }
	const viaType = await withServer((handle) => batchStep(handle, { dslManifest: manifest, sampleFrames: [0] }))
	const viaPath = await withServer((handle) =>
		batchStep(handle, { dslManifest: manifest, sampleFrames: [0] }, { viaPath: true }),
	)
	assert.equal(viaPath.kind, 'batch-step')
	assert.equal(viaPath.ok, true)
	const nameOf = (env) => env.frames['0'].geometries.map((g) => g.name).sort().join(',')
	assert.equal(nameOf(viaType), nameOf(viaPath))
	assert.equal(viaPath.compactDomTsv.split('\n').length, viaType.compactDomTsv.split('\n').length)
	assert.deepEqual(viaPath.compactDomTsv, viaType.compactDomTsv)
})

test('helpers:true scripts see the preloaded _mg runtime without carrying it', async () => {
	await withServer(async (handle) => {
		const seq = `mg-${Math.random().toString(36).slice(2)}`
		const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'script',
				seq,
				helpers: true,
				code: `var id = _mg.shape('rectangle', 'MgCard', { 'generator.dimensions': [120, 60] });
				_mg.alias(id, 'mg_card');
				return _mg.aliases();`,
			}),
		})
		assert.equal(response.status, 200)
		const envelope = await handle.get()
		assert.equal(envelope.ok, true, envelope.error ?? 'helpers script must run')
		assert.ok(envelope.result['@mg_card'], 'alias registered through _mg')
	})
})

test('batch-step restores the playhead and reports render failures per frame', async () => {
	await withServer(async (handle) => {
		// A real *file* used as the output directory guarantees mkdir fails on
		// every platform — no drive-letter or permission luck involved.
		const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-step-fail-')), 'occupied')
		fs.writeFileSync(blocker, 'not a directory')
		const envelope = await batchStep(handle, {
			script: `api.primitive('rectangle', 'x');`,
			sampleFrames: [2],
			renderFrames: true,
			renderOutputDir: path.join(blocker, 'frames'),
		})
		assert.equal(envelope.ok, true, 'a failed render must not fail the batch')
		assert.equal(envelope.rendered, 0)
		assert.ok(Array.isArray(envelope.renderErrors) && envelope.renderErrors.length === 1)
		assert.equal(envelope.restoredFrame, 0)
	})
})

test('preloaded host: batch-step manifests run through the preload branch without the _mg TDZ', async () => {
	// A live Cavalry shares one script context where the startup preload has
	// defined globalThis._mg. In that shape the batch-step manifest interpreter
	// used to die with "Cannot access '_mg' before initialization" — the mock's
	// fresh context per call could never reproduce it. preloadMg seeds ONE
	// persistent context with the preload, so this suite runs the exact branch
	// the live host runs.
	await withServer(async (handle) => {
		const envelope = await batchStep(handle, {
			dslManifest: {
				comp: { width: 960, height: 540, fps: 30, endFrame: 90, bg: '#101418' },
				layers: [{ as: 'probe', kind: 'shape', shape: 'rectangle', attrs: { 'generator.dimensions': [200, 100], position: [10, 20] } }],
				ops: [{ op: 'set', target: '$probe', attrs: { opacity: 80 } }],
			},
			sampleFrames: [0],
		})
		assert.equal(envelope.kind, 'batch-step')
		assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
		const manifest = envelope.manifestResult ?? {}
		assert.equal(manifest.ok, true, JSON.stringify(manifest.errors))
		assert.ok(manifest.created?.probe, `probe alias must map to a created layer: ${JSON.stringify(manifest.created)}`)
		// The layer really exists in the shared scene and carries the op's write.
		const readback = await handle.get()
		assert.equal(readback.kind, 'batch-step')
		assert.match(envelope.compactDomTsv ?? '', /probe/)
	}, { preloadMg: true })
})
