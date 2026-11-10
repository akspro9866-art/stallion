/**
 * Result-envelope promotion for queued loopback script results (extracted from Callbacks.ts; behaviour unchanged).
 */

/**
 * Canonical `kind` values that introspection scripts return *inside* the
 * wrapped `result` document. `#wrapped` always labels its own envelope
 * `kind: "result"`; the readback/snapshot/batch handlers promote the inner
 * document to the top level for GET /get (see `#serveReshaped`).
 */
const CANONICAL_RESULT_KINDS = new Set<string>([
	'state',
	'layers',
	'snapshot',
	'snapshot-batch',
	'batch-step',
	'batch_inspect',
	'export_comp_rig_overrides',
	'checkpoint',
	'rollback',
	'render_frame_fast',
])

/**
 * Apply `#serveReshaped`'s promotion to a queued loopback envelope.
 *
 * Live hosts deliver every wrapped script on TWO channels: the shared-context
 * stash (consumed synchronously by `#serveReshaped`) and a loopback
 * `__stallion_result__` POST that `onPost` drains a tick later. Without this
 * reshape the loopback overwrites the canonical envelope with the raw
 * wrapper, so a client that asked for `kind: "state"` receives
 * `kind: "result"` — the mock never sees it because it serves introspection
 * directly. The seq guard keeps stale stashes and user scripts that happen to
 * return a lookalike document from being promoted.
 */
export function reshapeWrappedResult(doc: Record<string, unknown>): Record<string, unknown> | null {
	const inner =
		typeof doc.result === 'object' && doc.result !== null && !Array.isArray(doc.result)
			? (doc.result as Record<string, unknown>)
			: null
	if (!inner) return null
	const kind = typeof inner.kind === 'string' ? inner.kind : ''
	if (!CANONICAL_RESULT_KINDS.has(kind)) return null
	if ((inner.seq ?? null) !== (doc.seq ?? null)) return null
	return { ...inner, seq: doc.seq, kind, ok: doc.ok === true && inner.ok !== false }
}
