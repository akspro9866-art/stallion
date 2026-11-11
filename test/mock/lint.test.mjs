/**
 * Vision-free scene lint tests — WCAG contrast, AABB text overlap, 90%
 * title-safe clipping, receipt wiring and the scripts/lint.mjs CLI.
 *
 * Runs against the built mock bundle (npm test builds first), mirroring the
 * other mock tests so the CLI and the server share one implementation.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	MockApi,
	MockScene,
	SCENE_LINT_BODY_CONTRAST,
	SCENE_LINT_LARGE_CONTRAST,
	SCENE_LINT_LARGE_TEXT_PX,
	SCENE_LINT_SAMPLE_FRACTIONS,
	SCENE_LINT_TITLE_SAFE_MARGIN,
	contrastRatio,
	formatSceneLintReport,
	lintSceneGraph,
	lintSceneGraphAtFrame,
	parseColor,
	relativeLuminance,
	startMockServer,
} from '../../dist/stallion-mock.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '../..')
const CLI = path.join(ROOT, 'scripts', 'lint.mjs')

function makeScene() {
	const scene = new MockScene({ strictSchema: false })
	const api = new MockApi(scene)
	const comp = scene.activeComp()
	return { scene, api, comp }
}

function addText(api, name, attrs) {
	const id = api.create('textShape', name)
	api.set(id, attrs)
	return id
}

function withTempScript(contents, run) {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-lint-')), 'scene.js')
	fs.writeFileSync(file, contents)
	try {
		return run(file)
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true })
	}
}

test('scene lint: colour maths follows the WCAG 2.x formula', () => {
	assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 })
	assert.deepEqual(parseColor('#0f766e'), { r: 15, g: 118, b: 110, a: 1 })
	assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 128 / 255 })
	assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 })
	assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 })
	assert.equal(parseColor('not-a-colour'), null)
	assert.equal(parseColor(undefined), null)
	assert.equal(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 }), 0)
	assert.equal(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 }), 1)
	const blackAndWhite = contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 })
	assert.equal(Math.round(blackAndWhite * 100) / 100, 21)
	assert.equal(SCENE_LINT_BODY_CONTRAST, 4.5)
	assert.equal(SCENE_LINT_LARGE_CONTRAST, 3)
	assert.equal(SCENE_LINT_LARGE_TEXT_PX, 24)
	assert.equal(SCENE_LINT_TITLE_SAFE_MARGIN, 0.05)
	assert.deepEqual([...SCENE_LINT_SAMPLE_FRACTIONS], [0, 0.25, 0.5, 0.75, 1])
});

test('scene lint: a readable, contained scene passes and the playhead is restored', () => {
	const { scene, api, comp } = makeScene()
	addText(api, 'Title', { text: 'Shipping today', fontSize: 60, position: [0, 0], 'material.materialColor': '#ffffff' })
	const card = api.create('rectangleShape', 'Card')
	api.set(card, { 'generator.dimensions': [900, 300], position: [0, -300], 'material.materialColor': '#0f766e' })
	addText(api, 'Label', { text: 'Contrast proof', fontSize: 32, position: [0, -300], 'material.materialColor': '#ffffff' })

	scene.frame = 77
	const report = lintSceneGraph(scene)
	assert.equal(scene.frame, 77, 'lint restores the caller playhead')
	assert.equal(report.passed, true, JSON.stringify(report.findings))
	assert.equal(report.compId, comp.id)
	assert.deepEqual(report.frames, [0, 54, 108, 161, 215])
	assert.equal(report.checked.frames, 5)
	assert.equal(report.checked.textLayers, 2)
	assert.deepEqual(report.findings, [])
	assert.deepEqual(report.counts, { contrast: 0, overlap: 0, 'title-safe': 0 })
	assert.match(formatSceneLintReport(report)[0], /^PASS scene-lint: 2 text layers over 5 frames/)
});

test('scene lint: body text needs 4.5:1 while large text clears 3:1', () => {
	const { scene, api } = makeScene()
	addText(api, 'Body', { text: 'Low contrast body', fontSize: 20, position: [0, 120], 'material.materialColor': '#5a5a5a' })
	addText(api, 'Large', { text: 'Large display', fontSize: 30, position: [0, -120], 'material.materialColor': '#5a5a5a' })
	const report = lintSceneGraphAtFrame(scene, 0)
	assert.equal(report.passed, false)
	const contrast = report.findings.filter((finding) => finding.rule === 'contrast')
	assert.equal(contrast.length, 1, 'only the 20px text fails')
	assert.match(contrast[0].detail, /"Low contrast body"/)
	assert.match(contrast[0].detail, /needs 4\.5:1 at 20px/)
	assert.deepEqual(contrast[0].frames, [0])

	// The same colour on a white card becomes readable (background resolution).
	const { scene: cardScene, api: cardApi } = makeScene()
	const card = cardApi.create('rectangleShape', 'White card')
	cardApi.set(card, { 'generator.dimensions': [1200, 400], position: [0, 0], 'material.materialColor': '#ffffff' })
	addText(cardApi, 'Ink', { text: 'Ink on paper', fontSize: 20, position: [0, 0], 'material.materialColor': '#5a5a5a' })
	const cardReport = lintSceneGraphAtFrame(cardScene, 0)
	assert.deepEqual(cardReport.findings.filter((finding) => finding.rule === 'contrast'), [])
});

test('scene lint: overlapping text blocks are reported once with every frame', () => {
	const { scene, api } = makeScene()
	addText(api, 'Old title', { text: 'Previous scene title', fontSize: 20, position: [0, 0], 'material.materialColor': '#ffffff' })
	addText(api, 'New title', { text: 'Still on screen', fontSize: 20, position: [8, 0], 'material.materialColor': '#ffffff' })
	const report = lintSceneGraph(scene)
	const overlap = report.findings.filter((finding) => finding.rule === 'overlap')
	assert.equal(overlap.length, 1)
	assert.equal(overlap[0].layers.length, 2)
	assert.deepEqual(overlap[0].frames, report.frames)
	assert.match(overlap[0].detail, /overlap 100% of the smaller text box/)
	assert.match(formatSceneLintReport(report)[0], /^FAIL scene-lint: 1 findings \(0 contrast, 1 overlap, 0 title-safe\)/)
});

test('scene lint: text outside the central 90% title-safe box is clipped', () => {
	const { scene, api } = makeScene()
	addText(api, 'Inside', { text: 'Safe', fontSize: 40, position: [0, 0], 'material.materialColor': '#ffffff' })
	addText(api, 'Outside', { text: 'Edge', fontSize: 40, position: [880, 0], 'material.materialColor': '#ffffff' })
	const report = lintSceneGraphAtFrame(scene, 0)
	const safe = report.findings.filter((finding) => finding.rule === 'title-safe')
	assert.equal(safe.length, 1)
	assert.equal(safe[0].layers[0], scene.comps.get(report.compId).layerIds[1])
	assert.match(safe[0].detail, /90% title-safe box \[-864, -486, 864, 486\]/)
});

test('scene lint: explicit frames and comp selection are honoured', () => {
	const { scene, api } = makeScene()
	addText(api, 'Title', { text: 'Frame sample', fontSize: 40, position: [0, 0], 'material.materialColor': '#ffffff' })
	const report = lintSceneGraph(scene, { frames: [12, 24, 24, 999] })
	assert.deepEqual(report.frames, [12, 24], 'dedupes, sorts and clamps to the comp range')
	const missing = lintSceneGraph(scene, { compId: 'compNode#99' })
	assert.equal(missing.compId, null)
	assert.equal(missing.passed, true)
});

test('scene lint: the standard receipt carries the lint report', async () => {
	const handle = await startMockServer({ port: 0, strictSchema: false })
	try {
		const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'script',
				seq: 'lint-receipt',
				beatFrames: [0, 12, 24],
				code: [
					"const t = api.create('textShape', 'Receipt title')",
					"api.set(t, { text: 'Readable receipt', fontSize: 40, position: [0, 0], 'material.materialColor': '#ffffff' })",
					'return { id: t }',
				].join('\n'),
			}),
		})
		assert.equal(response.status, 200)
		const result = await fetch(`http://127.0.0.1:${handle.port}/get`)
		assert.equal(result.status, 200)
		const envelope = await result.json()
		assert.equal(envelope.seq, 'lint-receipt')
		assert.equal(envelope.ok, true)
		assert.ok(envelope.receipt.lint, 'receipt.lint is present')
		assert.equal(envelope.receipt.lint.passed, true)
		assert.deepEqual(envelope.receipt.lint.frames, [0, 12, 24])
		assert.equal(envelope.state.receipt.lint.passed, true)
	} finally {
		await handle.close()
	}
});

test('scene lint CLI: pass/fail exit codes, JSON mode and help', () => {
	const passing = [
		"const t = api.create('textShape', 'Title')",
		"api.set(t, { text: 'Clean scene', fontSize: 40, position: [0, 0], 'material.materialColor': '#ffffff' })",
	].join('\n')
	withTempScript(passing, (file) => {
		const result = spawnSync(process.execPath, [CLI, file], { cwd: ROOT, encoding: 'utf8' })
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stdout, /^PASS scene-lint:/)
	})

	const failing = [
		"const a = api.create('textShape', 'Ghost')",
		"api.set(a, { text: 'Ghost title', fontSize: 20, position: [0, 0], 'material.materialColor': '#151515' })",
		"const b = api.create('textShape', 'Edge')",
		"api.set(b, { text: 'Edge', fontSize: 40, position: [900, 500], 'material.materialColor': '#ffffff' })",
	].join('\n')
	withTempScript(failing, (file) => {
		const result = spawnSync(process.execPath, [CLI, file], { cwd: ROOT, encoding: 'utf8' })
		assert.equal(result.status, 2, result.stderr)
		assert.match(result.stdout, /^FAIL scene-lint:/)
		assert.match(result.stdout, /\[contrast\]/)
		assert.match(result.stdout, /\[title-safe\]/)

		const json = spawnSync(process.execPath, [CLI, file, '--json', '--frames', '0,30'], { cwd: ROOT, encoding: 'utf8' })
		assert.equal(json.status, 2)
		const report = JSON.parse(json.stdout)
		assert.deepEqual(report.frames, [0, 30])
		assert.equal(report.passed, false)
		assert.ok(report.counts.contrast >= 1)
		assert.ok(report.counts['title-safe'] >= 1)
	})

	const help = spawnSync(process.execPath, [CLI, '--help'], { cwd: ROOT, encoding: 'utf8' })
	assert.equal(help.status, 0)
	assert.match(help.stdout, /Usage: node scripts\/lint\.mjs <scene\.js>/)

	const missing = spawnSync(process.execPath, [CLI, 'no-such-scene.js'], { cwd: ROOT, encoding: 'utf8' })
	assert.equal(missing.status, 1)
	assert.match(missing.stderr, /scene script not found/)
});
