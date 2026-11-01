/**
 * Cross-version test runner: `node --test <glob>` needs Node 22+ glob
 * expansion, so the Node 20 leg of the matrix gets explicit file arguments.
 * Mirrors cavalry-mcp's test/run-tests.mjs.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const files = fs
	.readdirSync(testDir)
	.filter((name) => name.endsWith('.test.mjs'))
	.sort()
	.map((name) => path.join(testDir, name))

if (files.length === 0) {
	console.error('no *.test.mjs files found')
	process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
