/**
 * Deploy the compiled Stallion bridge into Cavalry 2.8.0's user Scripts
 * folder, so `Scripts → Stallion` picks the bundle up on next launch.
 *
 *   npm run deploy          (= npm run build && node scripts/deploy-cavalry.mjs)
 *
 * Target resolution mirrors the VS Code extension's own installer
 * (see src/vscode/commands/install.ts and README §2):
 *
 *   win32  → %APPDATA%\Cavalry\Scripts\Stallion.js
 *   darwin → ~/Library/Application Support/Cavalry/Scripts/Stallion.js
 *   else   → ~/.local/share/Cavalry/Scripts/Stallion.js
 *
 * `STALLION_DEPLOY_DIR` overrides the folder (CI / portable installs).
 * The script is idempotent and verifies what it shipped: byte size, SHA-256
 * and the version banner baked into the bundle are printed on every deploy.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const version = pkg.version;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const bundle = path.join(repoRoot, 'dist', 'Stallion.js');

/** The Cavalry user Scripts folder per platform (STALLION_DEPLOY_DIR overrides). */
export function resolveCavalryScriptsDir(platform = process.platform, appData = process.env.APPDATA, home = os.homedir(), override = process.env.STALLION_DEPLOY_DIR) {
	if (override) return path.resolve(override);
	if (platform === 'win32') {
		const roaming = appData || path.join(home, 'AppData', 'Roaming');
		return path.join(roaming, 'Cavalry', 'Scripts');
	}
	if (platform === 'darwin') {
		return path.join(home, 'Library', 'Application Support', 'Cavalry', 'Scripts');
	}
	return path.join(home, '.local', 'share', 'Cavalry', 'Scripts');
}

/** Read the `// VERSION x.y.z` banner esbuild bakes into the bundle. */
export function readBundleVersion(source) {
	const match = /^\/\/ VERSION ([0-9][^\s]*)/m.exec(String(source ?? ''));
	return match ? match[1] : null;
}

export function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Copy the built bundle into the Cavalry Scripts folder and verify the write.
 * Throws (never half-deploys) when the bundle is missing, stale, or the copy
 * does not read back byte-identical.
 */
export function deploy(options = {}) {
	const source = options.source ?? bundle;
	if (!fs.existsSync(source)) {
		throw new Error(`dist/Stallion.js not found at ${source} — run "npm run build" first.`);
	}
	const bytes = fs.readFileSync(source);
	const bannerVersion = readBundleVersion(bytes);
	if (!bannerVersion) {
		throw new Error('the bundle carries no `// VERSION` banner — the build is stale or corrupt; rebuild.');
	}
	if (bannerVersion !== version) {
		throw new Error(`bundle banner ${bannerVersion} does not match package.json ${version} — rebuild before deploy.`);
	}
	const targetDir = options.targetDir ?? resolveCavalryScriptsDir();
	fs.mkdirSync(targetDir, { recursive: true });
	const target = path.join(targetDir, 'Stallion.js');
	fs.writeFileSync(target, bytes);
	const deployed = fs.readFileSync(target);
	const digest = sha256(deployed);
	if (deployed.length !== bytes.length || digest !== sha256(bytes)) {
		throw new Error(`verify-after-write failed: ${target} does not match the built bundle byte for byte.`);
	}
	return {
		version,
		bannerVersion,
		source,
		target,
		bytes: deployed.length,
		sha256: digest,
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const result = deploy();
		console.log(`Stallion v${result.version} deployed.`);
		console.log(`  source: ${result.source}`);
		console.log(`  target: ${result.target}`);
		console.log(`  bytes : ${result.bytes}`);
		console.log(`  sha256: ${result.sha256}`);
		console.log('Open Cavalry and run Scripts → Stallion to start the bridge on :8080.');
	} catch (error) {
		console.error(`deploy failed: ${String(error?.message ?? error)}`);
		process.exitCode = 1;
	}
}
