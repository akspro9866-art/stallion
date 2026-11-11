/**
 * Strict JSON request/response envelope types and safe serialization helpers.
 */

export interface WireEnvelope<T = unknown> {
	ok: boolean;
	seq?: unknown;
	data?: T | null;
	rawText?: string | null;
	error?: string | null;
	status?: number;
	receipt?: unknown;
	state?: unknown;
	kind?: string;
	[key: string]: unknown;
}

/**
 * Wrap raw Cavalry callback output in a safe, non-throwing envelope.
 * If payload is plain text or malformed JSON, wraps as { ok: true, rawText: String(payload), data: null }
 * or { ok: false, error: String(payload) } so downstream JSON.parse never throws SyntaxError.
 */
export function safeWrapCavalryPayload(payload: unknown, seq?: unknown): WireEnvelope {
	if (payload === null || payload === undefined) {
		return { ok: true, seq: seq ?? null, data: null, rawText: '' };
	}
	if (payload instanceof Error) {
		return {
			ok: false,
			seq: seq ?? null,
			error: payload.message || String(payload),
			rawText: String(payload),
			data: null,
		};
	}
	if (typeof payload === 'object') {
		const obj = payload as Record<string, unknown>;
		const extractedData = obj.data !== undefined ? obj.data : (obj.result !== undefined ? obj.result : obj);
		return {
			ok: obj.ok !== false,
			seq: seq ?? obj.seq ?? null,
			...obj,
			data: extractedData as unknown,
			rawText: typeof obj.rawText === 'string' ? obj.rawText : null,
		};
	}
	if (typeof payload === 'string') {
		const trimmed = payload.trim();
		if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
			try {
				const parsed = JSON.parse(trimmed);
				if (parsed && typeof parsed === 'object') {
					const obj = parsed as Record<string, unknown>;
					return {
						ok: obj.ok !== false,
						seq: seq ?? obj.seq ?? null,
						...obj,
						data: obj.data ?? obj.result ?? null,
						rawText: payload,
					};
				}
			} catch {
				// Malformed JSON falls through to rawText envelope
			}
		}
		// Plain text or unparseable payload
		return {
			ok: true,
			seq: seq ?? null,
			rawText: String(payload),
			data: null,
		};
	}
	return {
		ok: true,
		seq: seq ?? null,
		rawText: String(payload),
		data: payload,
	};
}

/**
 * Safe serializer that produces guaranteed-parseable JSON string.
 */
export function safeSerializeEnvelope(payload: unknown, seq?: unknown): string {
	const wrapped = safeWrapCavalryPayload(payload, seq);
	try {
		return JSON.stringify(wrapped);
	} catch (err) {
		return JSON.stringify({
			ok: false,
			seq: seq ?? null,
			error: `Serialization error: ${String(err)}`,
			rawText: String(payload),
			data: null,
		});
	}
}

/**
 * Parses wire string into a WireEnvelope safely without throwing SyntaxError.
 */
export function parseWirePayload<T = unknown>(raw: string | unknown): WireEnvelope<T> {
	if (typeof raw !== 'string') {
		return safeWrapCavalryPayload(raw) as WireEnvelope<T>;
	}
	try {
		const parsed = JSON.parse(raw);
		return safeWrapCavalryPayload(parsed) as WireEnvelope<T>;
	} catch {
		return { ok: true, rawText: raw, data: null } as WireEnvelope<T>;
	}
}
