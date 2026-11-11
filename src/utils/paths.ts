/**
 * Cross-OS path normalization to forward slashes.
 */
export function normalizePath(p: string): string {
	return typeof p === 'string' ? p.replace(/\\/g, '/') : p;
}
