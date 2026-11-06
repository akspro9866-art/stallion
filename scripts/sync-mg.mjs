// Regenerate src/cavalry/modules/mgRuntime.ts from the sibling cavalry-mcp
// checkout. The generated module is committed, so a standalone stallion clone
// builds without the sibling present; `npm run sync-mg` refreshes the vendored
// copy after cavalry-mcp's `_mg` runtime changes.
//
// The strings live inside cavalry-mcp as exported TypeScript constants, so
// this script bundles those two modules with esbuild, evaluates them, and
// embeds the resulting strings as JSON literals — JSON string syntax is valid
// TypeScript, and JSON.stringify cannot be fooled by backticks or ${…} in the
// runtime source.
import { buildSync } from 'esbuild'
import { createRequire } from 'module'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createHash } from 'crypto'

const root = path.resolve(import.meta.dirname, '..')
const sibling = process.env.CAVALRY_MCP_DIR || path.resolve(root, '..', 'cavalry-mcp')
const sources = {
	helpers: path.join(sibling, 'src', 'runtime', 'mg_helpers.ts'),
	manifest: path.join(sibling, 'src', 'runtime', 'mg_manifest.ts'),
}
const missing = Object.entries(sources).filter(([, file]) => !existsSync(file))
if (missing.length) {
	console.error(`sync-mg: missing cavalry-mcp sources: ${missing.map(([name, file]) => `${name}=${file}`).join(', ')}`)
	console.error('sync-mg: point CAVALRY_MCP_DIR at a cavalry-mcp checkout and retry.')
	process.exit(1)
}

const require = createRequire(import.meta.url)

/** Bundle one TS module to CJS in a temp dir, evaluate it, return its exports. */
function bundleAndEvaluate(entry, workDir, name) {
	const result = buildSync({
		entryPoints: [entry],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
		logLevel: 'silent',
	})
	const file = path.join(workDir, `${name}.cjs`)
	writeFileSync(file, result.outputFiles[0].text)
	return require(file)
}

const workDir = mkdtempSync(path.join(tmpdir(), 'stallion-sync-mg-'))
try {
	const helpers = bundleAndEvaluate(sources.helpers, workDir, 'mg-helpers')
	const manifest = bundleAndEvaluate(sources.manifest, workDir, 'mg-manifest')
	if (typeof helpers.MG_HELPERS_SOURCE !== 'string' || !helpers.MG_HELPERS_SOURCE.includes('const _mg')) {
		console.error('sync-mg: cavalry-mcp did not export MG_HELPERS_SOURCE as expected; refusing to overwrite.')
		process.exit(1)
	}
	if (typeof manifest.MG_MANIFEST_RUNTIME !== 'string' || !manifest.MG_MANIFEST_RUNTIME.includes('__mgApplyManifest')) {
		console.error('sync-mg: cavalry-mcp did not export MG_MANIFEST_RUNTIME as expected; refusing to overwrite.')
		process.exit(1)
	}
	const pkg = JSON.parse(readFileSync(path.join(sibling, 'package.json'), 'utf8'))
	const hash = createHash('sha256')
	hash.update(helpers.MG_HELPERS_SOURCE)
	hash.update(manifest.MG_MANIFEST_RUNTIME)
	const generated = `/**
 * Vended \`_mg\`/\`_rb\` runtime + the declarative manifest interpreter. The
 * underscores stay unescaped here: \`_ inside this template literal trips
 * eslint's no-useless-escape.
 *
 * GENERATED FILE — do not edit. Source of truth:
 *   cavalry-mcp@${pkg.version} src/runtime/mg_helpers.ts (MG_HELPERS_SOURCE)
 *   cavalry-mcp@${pkg.version} src/runtime/mg_manifest.ts (MG_MANIFEST_RUNTIME)
 * Regenerate against a sibling checkout with: npm run sync-mg
 * Content hash (sha256): ${hash.digest('hex')}
 */

export const MG_RUNTIME_VERSION = ${JSON.stringify(`cavalry-mcp@${pkg.version}`)}

/** Injected into Cavalry ahead of user code; defines \`_mg\` and \`_rb\`. */
export const MG_HELPERS_SOURCE = ${JSON.stringify(helpers.MG_HELPERS_SOURCE)}

/** Defines \`_mgApplyManifest(manifest)\`; needs \`_mg\` in scope when called. */
export const MG_MANIFEST_RUNTIME = ${JSON.stringify(manifest.MG_MANIFEST_RUNTIME)}
`
	const target = path.join(root, 'src', 'cavalry', 'modules', 'mgRuntime.ts')
	writeFileSync(target, generated)
	console.log(`sync-mg: wrote ${path.relative(root, target)} (cavalry-mcp@${pkg.version}, ${helpers.MG_HELPERS_SOURCE.length + manifest.MG_MANIFEST_RUNTIME.length} bytes of runtime source)`)
} finally {
	rmSync(workDir, { recursive: true, force: true })
}
