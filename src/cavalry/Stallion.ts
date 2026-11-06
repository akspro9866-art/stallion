import { Callbacks, VERSION } from './modules/Callbacks.ts'
import { MG_HELPERS_SOURCE, MG_RUNTIME_VERSION } from './modules/mgRuntime.ts'

const SUPPORTED_VERSION = '2.4.0'
const invalid = cavalry.versionLessThan(SUPPORTED_VERSION)
if (invalid) {
	throw new Error(`Stallion requires Cavalry ${SUPPORTED_VERSION} or higher`)
}

// Optional overrides from <app data>/stallion.json — see Callbacks.loadConfig.
const config = Callbacks.loadConfig()

const server = new api.WebServer()
const cb = new Callbacks(server, config)
server.listen(config.host, config.port)

/**
 * Preload the `_mg`/`_rb` helper runtime into the global context so callers
 * of /post (and /batch-step) send compact `_mg` commands and declarative
 * manifests instead of re-transmitting the helper library on every request.
 * Isolated script contexts cannot see this binding; both `#wrapped` (helpers
 * flag) and the batch-step runtime detect that and define the runtime from
 * the same vendored source inline, so the wire payload is identical.
 */
const mgPreload = `;(function () {
	var __g = typeof globalThis !== 'undefined' ? globalThis : this;
	try {
		if (__g._mg && typeof __g._mg.shape === 'function') return;
		${MG_HELPERS_SOURCE}
		__g._mg = _mg;
		__g._rb = _rb;
	} catch (e) {
		console.warn('Stallion: _mg preload skipped: ' + String(e && e.message ? e.message : e));
	}
})()`
if (!api.exec('io.scenery.stallion.mg-preload', mgPreload)) {
	console.warn('Stallion: _mg preload exec failed; batch-step falls back to inline runtime')
}
server.addCallbackObject(cb)
server.setHighFrequency()
if (config.token) {
	(server as unknown as { setTokenAuthentication(token: string): void }).setTokenAuthentication(config.token)
	console.warn('Stallion: token authentication enabled via stallion.json')
}

// Serve a heartbeat on GET /get until the first script result arrives.
cb.serveStatus()

const Align = { CENTRE: 1 as 0 | 1 | 2 }
const label = new ui.Label(`v${VERSION} — listening on ${config.host}:${config.port} — _mg ${MG_RUNTIME_VERSION}`)
label.setAlignment(Align.CENTRE)
const readme = new ui.Label(
	'[Documentation](https://github.com/akspro9866-art/stallion#readme)',
)
readme.setAlignment(Align.CENTRE)

const layout = new ui.VLayout()
layout.addStretch()
layout.add(label, readme)
layout.addStretch()
ui.setTitle('Stallion')
ui.add(layout)
ui.show()
