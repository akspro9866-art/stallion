// Live Cavalry integration requires an explicit, deliberate opt-in: the
// CAVALRY_LIVE environment variable must be exactly 'true' (mirrored by the
// workflow_dispatch-only `live-cavalry` CI job). Without it this script is a
// deterministic no-op that skips, so headless runs on hosted runners can never
// hang or fail on connection refused against port 8080.
if (process.env.CAVALRY_LIVE !== 'true') {
  console.log('Live preflight skipped: CAVALRY_LIVE !== "true". Headless verification remains available via npm run test:ci.')
  process.exit(0)
}

// Opt-in granted: verify a Cavalry 2.8.0 bridge is actually reachable before
// any real suite would run. This performs a single health GET — no scene
// mutation — and reports the reachable endpoint.
const host = process.env.STALLION_HOST || '127.0.0.1'
const port = process.env.STALLION_PORT || '8080'
const url = `http://${host}:${port}/health`
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) {
    console.error(`Live preflight failed: ${url} answered HTTP ${response.status}.`)
    process.exitCode = 1
  } else {
    const body = await response.json().catch(() => null)
    console.log(`Live preflight passed: ${url} is reachable (${body && body.status ? body.status : 'ok'}).`)
  }
} catch (error) {
  console.error(`Live preflight failed: could not reach ${url} (${error && error.message ? error.message : error}). Start Cavalry 2.8.0 with Scripts -> Stallion enabled, then re-run.`)
  process.exitCode = 1
}
