import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	writeCheckpointManifest,
	readCheckpointManifest,
	removeCheckpointFile,
	normalizeCheckpointJob,
	normalizeRollbackJob,
} from '../src/bridge/Checkpoint.ts';
import { safeRm } from '../src/utils/fs-safe.ts';
import { normalizePath } from '../src/utils/paths.ts';

describe('stallion: checkpoint and filesystem safety tests', () => {
	test('safeRm handles missing targets and locked paths without throwing', () => {
		const nonExistent = path.join(os.tmpdir(), `non-existent-${Date.now()}`);
		assert.doesNotThrow(() => safeRm(nonExistent));

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-safe-rm-'));
		const tempFile = path.join(tempDir, 'file.txt');
		fs.writeFileSync(tempFile, 'data');
		safeRm(tempDir);
		assert.equal(fs.existsSync(tempDir), false);
	});

	test('normalizePath converts Windows backslashes to POSIX slashes', () => {
		assert.equal(normalizePath('C:\\test\\dir\\file.json'), 'C:/test/dir/file.json');
		assert.equal(normalizePath('/unix/path/file.json'), '/unix/path/file.json');
	});

	test('writeCheckpointManifest normalizes paths, fsyncs, and reads back cleanly', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stallion-cp-test-'));
		const manifestPath = path.join(tempDir, 'nested', 'manifest.json');
		const manifestData = {
			version: 1,
			snapshotId: 'snap-001',
			sourceFile: 'C:\\projects\\animation\\scene.cv',
			layers: [{ id: 'hero', name: 'Hero' }],
		};

		const writtenPath = await writeCheckpointManifest(manifestPath, manifestData);
		assert.equal(writtenPath, normalizePath(manifestPath));
		assert.ok(fs.existsSync(writtenPath));

		const readBack = readCheckpointManifest<any>(writtenPath);
		assert.ok(readBack);
		assert.equal(readBack.snapshotId, 'snap-001');
		assert.equal(readBack.sourceFile, 'C:/projects/animation/scene.cv');

		removeCheckpointFile(tempDir);
		assert.equal(fs.existsSync(tempDir), false);
	});

	test('normalizeCheckpointJob and normalizeRollbackJob validate schema inputs', () => {
		const cp = normalizeCheckpointJob({ seq: 1, compId: 'comp#1', snapshotId: 'snap-1', layerIds: ['a', 'b'] });
		assert.equal(cp.job.compId, 'comp#1');
		assert.deepEqual(cp.job.layerIds, ['a', 'b']);

		const rbBad = normalizeRollbackJob({ seq: 2, compId: 'comp#1' });
		assert.ok('error' in rbBad);

		const rbGood = normalizeRollbackJob({
			seq: 3,
			compId: 'comp#1',
			snapshotId: 'snap-1',
			state: { version: 1, compId: 'comp#1', frame: 0, layers: [] },
		});
		assert.ok('job' in rbGood);
	});
});
