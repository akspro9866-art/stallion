/**
 * `helpers: true` script preamble — re-exported from Callbacks.ts so the mock bridge and tests keep the original import path (extracted from Callbacks.ts; behaviour unchanged).
 */

/**
 * Preamble for `helpers: true` script posts: define `_mg`/`_rb` in the
 * script's scope from the startup preload when it exists in this context, or
 * from the vendored source when it does not. The user body then runs with
 * `_mg` bound as a parameter-shaped local, so compact `_mg` calls arrive
 * without the helper library travelling over HTTP on every request.
 *
 * Only `globalThis._mg` is checked here (never a bare `_mg`): the `var _mg`
 * below hoists to the script scope and would shadow a global binding of the
 * same name inside any `typeof _mg` check. Exported because the mock bridge
 * must inject the identical preamble (mock-server.test.mjs pins both paths to
 * the same wire contract).
 */
export function mgHelpersPreamble(mgRuntimeSource: string): string {
	return `var __mgEnv = (function () {
	var __g = typeof globalThis !== 'undefined' ? globalThis : this;
	try {
		if (__g._mg && typeof __g._mg.shape === 'function') return { mg: __g._mg, rb: __g._rb || null };
	} catch (e) {}
	${mgRuntimeSource}
	try { __g._mg = _mg; __g._rb = _rb; } catch (e) {}
	return { mg: _mg, rb: _rb };
})();
var _mg = __mgEnv.mg;
var _rb = __mgEnv.rb;`
}
