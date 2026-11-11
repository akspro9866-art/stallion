/**
 * `Checkpoint` — scene state checkpointing with safe write streams and cross-OS path normalization.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizePath } from '../utils/paths.ts';
import { safeRm } from '../utils/fs-safe.ts';
import {
	CHECKPOINT_TYPE,
	ROLLBACK_TYPE,
	CHECKPOINT_MAX_LAYERS,
	CHECKPOINT_MAX_KEYFRAMES_PER_ATTR,
	CHECKPOINT_MAX_STATE_CHARS,
	type CheckpointJob,
	type RollbackJob,
	type CheckpointStateDoc,
	type CheckpointError,
	normalizeSnapshotId,
	normalizeCheckpointJob,
	normalizeRollbackJob,
	checkpointScript,
	rollbackScript,
} from '../cavalry/modules/Checkpoint.ts';

export {
	CHECKPOINT_TYPE,
	ROLLBACK_TYPE,
	CHECKPOINT_MAX_LAYERS,
	CHECKPOINT_MAX_KEYFRAMES_PER_ATTR,
	CHECKPOINT_MAX_STATE_CHARS,
	type CheckpointJob,
	type RollbackJob,
	type CheckpointStateDoc,
	type CheckpointError,
	normalizeSnapshotId,
	normalizeCheckpointJob,
	normalizeRollbackJob,
	checkpointScript,
	rollbackScript,
};

/**
 * Saves a checkpoint manifest to disk with strict POSIX path normalization,
 * guaranteed stream close, and fsync before resolution.
 */
export async function writeCheckpointManifest(
	targetPath: string,
	manifest: Record<string, unknown>,
): Promise<string> {
	const normalizedPath = normalizePath(targetPath);
	const parentDir = path.dirname(normalizedPath);
	if (!fs.existsSync(parentDir)) {
		fs.mkdirSync(parentDir, { recursive: true });
	}

	// Normalize all paths within manifest
	const normalizedManifest = JSON.parse(JSON.stringify(manifest), (_key, value) => {
		if (typeof value === 'string' && (value.includes('\\') || value.includes('/'))) {
			return normalizePath(value);
		}
		return value;
	});

	const content = JSON.stringify(normalizedManifest, null, 2);

	await new Promise<void>((resolve, reject) => {
		const stream = fs.createWriteStream(normalizedPath, { flags: 'w', encoding: 'utf8', autoClose: true });
		let openedFd: number | undefined;
		let settled = false;
		const finishReject = (err: unknown) => {
			if (settled) return;
			settled = true;
			reject(err);
		};
		stream.on('open', (fd) => {
			openedFd = fd;
		});
		stream.on('error', (err) => {
			if (!stream.closed) {
				stream.destroy();
			}
			finishReject(err);
		});
		stream.on('finish', () => {
			try {
				if (typeof openedFd === 'number' && !stream.closed) {
					fs.fsyncSync(openedFd);
				} else {
					const fd = fs.openSync(normalizedPath, 'r+');
					try {
						fs.fsyncSync(fd);
					} finally {
						fs.closeSync(fd);
					}
				}
				if (stream.closed) {
					if (!settled) {
						settled = true;
						resolve();
					}
					return;
				}
				stream.close((closeErr) => {
					if (closeErr) finishReject(closeErr);
					else if (!settled) {
						settled = true;
						resolve();
					}
				});
			} catch (syncErr) {
				stream.destroy();
				finishReject(syncErr);
			}
		});
		stream.end(content, 'utf8');
	});

	return normalizedPath;
}

/**
 * Reads a checkpoint manifest from disk safely.
 */
export function readCheckpointManifest<T = CheckpointStateDoc>(targetPath: string): T | null {
	const normalizedPath = normalizePath(targetPath);
	try {
		if (!fs.existsSync(normalizedPath)) return null;
		const raw = fs.readFileSync(normalizedPath, 'utf8');
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/**
 * Deletes a checkpoint target file with Windows retry-safety.
 */
export function removeCheckpointFile(targetPath: string): void {
	safeRm(normalizePath(targetPath));
}
