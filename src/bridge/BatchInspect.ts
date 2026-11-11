/**
 * `BatchInspect` — atomic batch execution & introspection.
 */
import { normalizePath } from '../utils/paths.ts';
import {
	BATCH_INSPECT_TYPE,
	BATCH_INSPECT_MAX_FRAMES,
	BATCH_INSPECT_MAX_LAYERS,
	BATCH_INSPECT_MAX_ATTRS,
	type BatchInspectJob,
	type BatchInspectError,
	normalizeBatchInspectJob,
	batchInspectScript,
} from '../cavalry/modules/BatchInspect.ts';

export {
	BATCH_INSPECT_TYPE,
	BATCH_INSPECT_MAX_FRAMES,
	BATCH_INSPECT_MAX_LAYERS,
	BATCH_INSPECT_MAX_ATTRS,
	type BatchInspectJob,
	type BatchInspectError,
	normalizeBatchInspectJob,
	batchInspectScript,
};

/**
 * Normalizes all path fields in a BatchInspect response envelope to POSIX slashes.
 */
export function normalizeBatchInspectOutput<T extends Record<string, unknown>>(output: T): T {
	if (!output || typeof output !== 'object') return output;
	const copy = { ...output };
	for (const [key, val] of Object.entries(copy)) {
		if (typeof val === 'string' && (val.includes('\\') || val.includes('/'))) {
			(copy as Record<string, unknown>)[key] = normalizePath(val);
		}
	}
	return copy;
}
