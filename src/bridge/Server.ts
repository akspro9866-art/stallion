/**
 * HTTP Bridge Server on port 8080 (`src/bridge/Server.ts`).
 * Dispatches scripts, batch operations, and introspections to Cavalry,
 * wrapping all callback outputs in a safe JSON wire envelope.
 */
import { safeSerializeEnvelope, safeWrapCavalryPayload, type WireEnvelope } from '../protocol/wire.ts';
import { normalizePath } from '../utils/paths.ts';

export const DEFAULT_BRIDGE_PORT = 8080;
export const DEFAULT_BRIDGE_HOST = '127.0.0.1';

export interface BridgeServerConfig {
	port?: number;
	host?: string;
	token?: string;
}

export class BridgeServer {
	readonly port: number;
	readonly host: string;
	readonly token?: string;

	constructor(config: BridgeServerConfig = {}) {
		this.port = config.port ?? DEFAULT_BRIDGE_PORT;
		this.host = config.host ?? DEFAULT_BRIDGE_HOST;
		this.token = config.token;
	}

	/**
	 * Formats and safely serializes a Cavalry execution or introspection response.
	 */
	formatResponse(rawPayload: unknown, seq?: unknown): string {
		return safeSerializeEnvelope(rawPayload, seq);
	}

	/**
	 * Wraps an incoming result or error into a structured WireEnvelope.
	 */
	wrapPayload(payload: unknown, seq?: unknown): WireEnvelope {
		return safeWrapCavalryPayload(payload, seq);
	}

	/**
	 * Normalizes file path targets before transmitting across the wire.
	 */
	normalizeTarget(targetPath: string): string {
		return normalizePath(targetPath);
	}
}
