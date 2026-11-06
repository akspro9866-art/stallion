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

function collect(directory) {
	const found = []
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name)
		if (entry.isDirectory()) found.push(...collect(full))
		else if (entry.name.endsWith('.test.mjs')) found.push(full)
	}
	return found
}

const files = collect(testDir).sort()

if (files.length === 0) {
	console.error('no *.test.mjs files found')
	process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
