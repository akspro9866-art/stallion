/**
 * FIFO execution queue for the mock bridge's HTTP surface.
 *
 * Heavy workloads (FFmpeg frame exports, multi-frame batch evaluations) must
 * never drop or reorder subsequent single-shot IIFE calls: every request that
 * mutates or reads the shared mock scene is serialised through one queue, and
 * each unit of work is bounded by a configurable per-request timeout so a
 * stuck handler cannot block the pipeline forever.
 *
 * Timeout semantics: the ceiling measures EXECUTION time — the clock starts
 * when the unit leaves the queue, not while it waits its turn — so a queued
 * single-shot call is never penalised for time spent behind a legitimate
 * heavy export. The queue tail always advances: a timed-out unit settles on
 * its own while later units proceed.
 */

export interface RequestQueueOptions {
	/** Per-request execution ceiling in milliseconds. Default 30_000. */
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export class RequestQueue {
	#tail: Promise<void> = Promise.resolve()
	#timeoutMs: number
	#position = 0
	#inFlight = 0

	constructor(options: RequestQueueOptions = {}) {
		const parsed = Number(options.timeoutMs ?? process.env.STALLION_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
		this.#timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
	}

	get timeoutMs(): number {
		return this.#timeoutMs
	}

	/** Units enqueued but not yet settled (waiting in the queue or running). */
	get pending(): number {
		return this.#inFlight
	}

	/** Total requests enqueued over the server's lifetime (monotonic). */
	get total(): number {
		return this.#position
	}

	/**
	 * Serialise `work` after every previously enqueued unit. The returned
	 * promise resolves with the work's value or rejects on thrown error /
	 * execution timeout — whichever happens first. The queue tail always waits
	 * for the underlying work to settle before starting the next unit.
	 */
	enqueue<T>(work: () => Promise<T> | T): Promise<T> {
		this.#position += 1
		const position = this.#position
		this.#inFlight += 1
		const run = this.#tail.then(
			() =>
				new Promise<T>((resolve, reject) => {
					const timer = setTimeout(() => {
						reject(new Error(`request timeout after ${this.#timeoutMs}ms (queue position ${position})`))
					}, this.#timeoutMs)
					if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
						;(timer as { unref: () => void }).unref()
					}
					Promise.resolve()
						.then(work)
						.then(
							(value) => {
								clearTimeout(timer)
								resolve(value)
							},
							(error) => {
								clearTimeout(timer)
								reject(error)
							},
						)
				}),
		)
		// The queue tail waits for the WORK to settle; the caller's promise is
		// the same run promise (rejection on timeout or thrown error).
		this.#tail = run.then(
			(): void => {
				this.#inFlight = Math.max(0, this.#inFlight - 1)
			},
			(): void => {
				this.#inFlight = Math.max(0, this.#inFlight - 1)
			},
		)
		return run
	}
}
