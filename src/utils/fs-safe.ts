import fs from 'node:fs';

/**
 * Windows retry-safe file and directory removal.
 * Retries on EBUSY / EPERM / ENOTEMPTY locks common on Windows filesystems.
 */
export function safeRm(targetPath: string): void {
	if (!fs.existsSync(targetPath)) return;
	fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
