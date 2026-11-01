/**
 * Mock bridge CLI — `node dist/stallion-mock.mjs --mock`.
 *
 * Boots the headless in-memory Cavalry 2.8 bridge for CI and local testing.
 * Boot conditions: the `--mock` flag, or `STALLION_MOCK=1` in the
 * environment. Without either, direct execution prints usage and exits 0 so
 * wiring it into scripts never hard-fails a pipeline that did not ask for a
 * mock. Importing the bundle programmatically is also supported —
 * `startMockServer`, `shouldBootMock` and `bootMockFromArgv` are re-exported.
 */

import { pathToFileURL } from 'node:url'
import { bootMockFromArgv, shouldBootMock, startMockServer, type MockServerHandle, type MockServerOptions } from '../mock/server.ts'

export { bootMockFromArgv, shouldBootMock, startMockServer }
export type { MockServerHandle, MockServerOptions }

const invokedDirectly = (() => {
	try {
		return import.meta.url === pathToFileURL(process.argv[1] ?? '').href
	} catch {
		return false
	}
})()

if (invokedDirectly && !shouldBootMock()) {
	process.stdout.write(
		'Usage: node dist/stallion-mock.mjs --mock [--host 127.0.0.1] [--port 8080] [--token T] [--lax] [--verbose]\n' +
			'Boot conditions: --mock flag, or STALLION_MOCK=1 environment variable.\n',
	)
	process.exit(0)
}

if (invokedDirectly) {
	await bootMockFromArgv()
}
