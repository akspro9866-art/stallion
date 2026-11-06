/**
 * Windows-safe scratch-tree teardown for the Stallion test suites.
 *
 * A plain `fs.rmSync(dir, { recursive: true, force: true })` throws `EBUSY` or
 * `EPERM` on Windows when something still holds a handle — the mock bridge's
 * HTTP socket, a `stallion.json` that was read one tick earlier, or an
 * antivirus scanner that opened the file asynchronously. Because these calls
 * sit at the end of a check block, the throw is reported as a test failure and
 * hides the result that actually passed.
 *
 * Same policy as `cavalry-mcp/src/shared/fs-safe.ts`: five retries at 150 ms, and a
 * tree that is already gone counts as success. Kept as a separate file because
 * Stallion ships as a VS Code extension and its `dist/` bundle must not grow a
 * dependency on anything outside `src/`; this is test-only code.
 */
import fs from 'node:fs'

export const REMOVE_MAX_RETRIES = 5
export const REMOVE_RETRY_DELAY_MS = 150

const TRANSIENT_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EAGAIN', 'ETIMEDOUT', 'UNKNOWN'])

export function isTransientRemoveError(error) {
  return TRANSIENT_CODES.has(error?.code)
}

function sleepSync(ms) {
  if (ms <= 0) return
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      /* SharedArrayBuffer unavailable: bounded busy wait. */
    }
  }
}

/**
 * Remove a directory tree, tolerating Windows handle locks.
 * @param {string} target
 * @param {{ maxRetries?: number, retryDelay?: number }} [options]
 * @returns {number} attempts used (1 means it went cleanly)
 */
export function removeTreeSync(target, options = {}) {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? REMOVE_MAX_RETRIES))
  const retryDelay = Math.max(0, Math.floor(options.retryDelay ?? REMOVE_RETRY_DELAY_MS))

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: REMOVE_MAX_RETRIES,
        retryDelay: REMOVE_RETRY_DELAY_MS,
      })
      return attempt + 1
    } catch (error) {
      if (error?.code === 'ENOENT') return attempt + 1
      if (!isTransientRemoveError(error)) throw error
      if (attempt === maxRetries) throw error
      sleepSync(retryDelay)
    }
  }
  return maxRetries + 1
}
