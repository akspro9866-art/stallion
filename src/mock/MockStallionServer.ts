/**
 * Headless mock bridge for CI (`MockStallionServer`).
 * Provides active socket tracking, fast socket teardown with server.closeAllConnections?.(),
 * and deterministic in-memory Cavalry scene mocking.
 */
import {
	startMockServer,
	type MockServerHandle,
	type MockServerOptions,
	MockApi,
	MockScene,
} from './server.ts';

export type { MockServerHandle, MockServerOptions };
export { startMockServer, MockApi, MockScene };

export class MockStallionServer {
	#handle: MockServerHandle | null = null;
	#options: MockServerOptions;

	constructor(options: MockServerOptions = {}) {
		this.#options = options;
	}

	get port(): number {
		if (!this.#handle) throw new Error('MockStallionServer has not been started');
		return this.#handle.port;
	}

	get host(): string {
		if (!this.#handle) throw new Error('MockStallionServer has not been started');
		return this.#handle.host;
	}

	get handle(): MockServerHandle | null {
		return this.#handle;
	}

	async start(): Promise<MockServerHandle> {
		if (this.#handle) return this.#handle;
		this.#handle = await startMockServer(this.#options);
		return this.#handle;
	}

	async stop(): Promise<void> {
		if (!this.#handle) return;
		await this.#handle.stop?.();
		this.#handle = null;
	}

	async close(): Promise<void> {
		await this.stop();
	}
}
