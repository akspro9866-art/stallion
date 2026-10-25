import { Callbacks, VERSION } from './modules/Callbacks.ts'

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
server.addCallbackObject(cb)
server.setHighFrequency()
if (config.token) {
	server.setTokenAuthentication(config.token)
	console.warn('Stallion: token authentication enabled via stallion.json')
}

// Serve a heartbeat on GET /get until the first script result arrives.
cb.serveStatus()

const Align = { CENTRE: 1 as 0 | 1 | 2 }
const label = new ui.Label(`v${VERSION} — listening on ${config.host}:${config.port}`)
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
