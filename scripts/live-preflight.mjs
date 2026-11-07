// Do not disguise headless protocol tests as a live Cavalry suite.
console.error('Live preflight failed: no real opt-in Cavalry integration suite exists in this repository. No connection or scene mutation was attempted. Use npm run test:ci for headless verification.')
process.exitCode = 1
