#!/usr/bin/env node
/**
 * scripts/lint.mjs — vision-free scene-graph lint CLI.
 *
 * Runs a scene-builder script against the headless mock (the same MockScene
 * and MockApi the bridge serves) and lints the resulting graph:
 *
 *   - WCAG contrast 4.5:1 body / 3:1 large text,
 *   - AABB text overlap at sampled frames (25% of the smaller box),
 *   - 90% title-safe clipping (5% margin per side).
 *
 * Usage:
 *   node scripts/lint.mjs <scene.js> [--frames 0,30,60] [--comp compNode#1]
 *                         [--body 4.5] [--large 3] [--title-safe 0.05]
 *                         [--overlap 0.25] [--json]
 *
 * The scene script receives `api` and `console` exactly like a bridge script
 * (`api.create`, `api.set`, `api.keyframe`, ...). Exit codes: 0 pass, 2 lint
 * findings, 1 usage/execution error. Requires `npm run build` (the CLI imports
 * dist/stallion-mock.mjs); `prepare` builds it on install.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const USAGE = `Usage: node scripts/lint.mjs <scene.js> [options]

Runs the scene script on the headless mock and lints the resulting graph:
WCAG contrast (4.5 body / 3 large), AABB text overlap at sampled frames and
90% title-safe clipping.

Options:
  --frames <a,b,c>     explicit frames (default 0/25/50/75/100% of the comp)
  --comp <id>          comp layer id (default: the active comp)
  --body <ratio>       body-text contrast threshold (default 4.5)
  --large <ratio>      large-text contrast threshold (default 3)
  --title-safe <frac>  title-safe margin per side (default 0.05 = 90% box)
  --overlap <ratio>    overlap of the smaller text box (default 0.25)
  --json               print the report as JSON
  --help               show this help

Exit codes: 0 pass, 2 lint findings, 1 usage/execution error.
Requires dist/stallion-mock.mjs (npm run build).`

function fail(message) {
	process.stderr.write(`${message}\n`)
	process.exit(1)
}

function parseArgs(argv) {
	const options = {}
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i]
		if (flag === '--help' || flag === '-h') return { help: true }
		if (flag === '--json') {
			options.json = true
			continue
		}
		if (!flag.startsWith('-')) {
			if (options.script === undefined) options.script = flag
			continue
		}
		const value = argv[i + 1]
		if (value === undefined || value.startsWith('--')) fail(`missing value for ${flag}\n\n${USAGE}`)
		switch (flag) {
			case '--frames':
				options.frames = value.split(',').map((part) => Number(part.trim())).filter((frame) => Number.isFinite(frame))
				break
			case '--comp':
				options.compId = value
				break
			case '--body':
				options.bodyContrast = Number(value)
				break
			case '--large':
				options.largeContrast = Number(value)
				break
			case '--title-safe':
				options.titleSafeMargin = Number(value)
				break
			case '--overlap':
				options.overlapRatio = Number(value)
				break
			default:
				fail(`unknown option ${flag}\n\n${USAGE}`)
		}
		i += 1
	}
	return options
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
	process.stdout.write(`${USAGE}\n`)
	process.exit(0)
}
if (!options.script) fail(USAGE)

const scriptPath = path.resolve(options.script)
if (!fs.existsSync(scriptPath)) fail(`scene script not found: ${scriptPath}`)

const bundlePath = path.resolve('dist/stallion-mock.mjs')
if (!fs.existsSync(bundlePath)) {
	fail(`mock bundle not found at ${bundlePath}\nRun \`npm run build\` first (npm install runs it via prepare).`)
}

let bundle
try {
	bundle = await import(pathToFileURL(bundlePath).href)
} catch (error) {
	fail(`failed to load ${bundlePath}: ${error.message}`)
}

const { MockApi, MockScene, executeOnMock, formatSceneLintReport, lintSceneGraph } = bundle
const scene = new MockScene({ strictSchema: false })
const api = new MockApi(scene)
const code = fs.readFileSync(scriptPath, 'utf8')
const ran = executeOnMock(code, api, {})
if (ran.error) {
	fail(`scene script failed: ${ran.error}`)
}
for (const entry of ran.console) {
	if (entry.level === 'error' || entry.level === 'warn') process.stderr.write(`[${entry.level}] ${entry.text}\n`)
}

const lintOptions = { ...options }
delete lintOptions.script
delete lintOptions.json
const report = lintSceneGraph(scene, lintOptions)
if (options.json) {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
	for (const line of formatSceneLintReport(report)) process.stdout.write(`${line}\n`)
}
process.exit(report.passed ? 0 : 2)
