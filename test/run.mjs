/**
 * Cross-version test runner: `node --test <glob>` needs Node 22+ glob
 * expansion, so the Node 20 leg of the matrix gets explicit file arguments.
 * Mirrors cavalry-mcp's test/run-tests.mjs.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const testDir = path.dirname(fileURLToPath(import.meta.url))

function collect(directory, ext = '.test.mjs') {
	const found = []
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name)
		if (entry.isDirectory()) found.push(...collect(full, ext))
		else if (entry.name.endsWith(ext)) found.push(full)
	}
	return found
}

const mjsFiles = collect(path.join(testDir, 'mock'), '.test.mjs').sort()
const tsTests = ['bridge.test.ts', 'checkpoint.test.ts']
	.map((name) => path.join(testDir, name))
	.filter((file) => fs.existsSync(file))

if (mjsFiles.length === 0 && tsTests.length === 0) {
	console.error('no test files found')
	process.exit(1)
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-ts-tests-'))
try {
	const compiledTsTests = []
	for (const tsFile of tsTests) {
		const outFile = path.join(workDir, `${path.basename(tsFile, '.ts')}.mjs`)
		buildSync({
			entryPoints: [tsFile],
			bundle: true,
			platform: 'node',
			format: 'esm',
			packages: 'external',
			outfile: outFile,
			logLevel: 'silent',
		})
		compiledTsTests.push(outFile)
	}
	const result = spawnSync(process.execPath, ['--test', ...mjsFiles, ...compiledTsTests], { stdio: 'inherit' })
	process.exitCode = result.status ?? 1
} finally {
	fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
