import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeServer } from '../src/bridge/Server.ts';
import { safeWrapCavalryPayload, safeSerializeEnvelope, parseWirePayload } from '../src/protocol/wire.ts';
import { MockStallionServer } from '../src/mock/MockStallionServer.ts';

describe('stallion: bridge and wire tests', () => {
	test('BridgeServer initializes with default port 8080 and normalizes paths', () => {
		const server = new BridgeServer();
		assert.equal(server.port, 8080);
		assert.equal(server.host, '127.0.0.1');
		assert.equal(server.normalizeTarget('C:\\Users\\test\\scene.cv'), 'C:/Users/test/scene.cv');
	});

	test('safeWrapCavalryPayload handles plain text, malformed JSON, and structured objects without throwing', () => {
		// Plain text string
		const plain = safeWrapCavalryPayload('Error: invalid layer', 'seq-1');
		assert.equal(plain.ok, true);
		assert.equal(plain.rawText, 'Error: invalid layer');
		assert.equal(plain.data, null);
		assert.equal(plain.seq, 'seq-1');

		// Malformed JSON string
		const malformed = safeWrapCavalryPayload('{ malformed json }', 'seq-2');
		assert.equal(malformed.ok, true);
		assert.equal(malformed.rawText, '{ malformed json }');
		assert.equal(malformed.data, null);

		// Valid JSON string
		const validJson = safeWrapCavalryPayload('{"result": 42}', 'seq-3');
		assert.equal(validJson.ok, true);
		assert.equal(validJson.data, 42);

		// Structured object
		const obj = safeWrapCavalryPayload({ ok: true, data: { layerId: 'l-1' } }, 'seq-4');
		assert.equal(obj.ok, true);
		assert.deepEqual(obj.data, { layerId: 'l-1' });
	});

	test('safeSerializeEnvelope and parseWirePayload roundtrip safely', () => {
		const serialized = safeSerializeEnvelope({ count: 5 }, 'seq-5');
		const parsed = parseWirePayload(serialized);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.seq, 'seq-5');
		assert.equal((parsed.data as any)?.count, 5);
	});

	test('MockStallionServer starts, answers, tracks sockets and closes cleanly', async () => {
		const mock = new MockStallionServer({ port: 0 });
		await mock.start();
		assert.ok(mock.port > 0);
		assert.equal(mock.host, '127.0.0.1');

		const res = await fetch(`http://127.0.0.1:${mock.port}/get`);
		assert.equal(res.status, 200);
		const data = await res.json();
		assert.equal(data.kind, 'status');

		await mock.stop();
		assert.equal(mock.handle, null);
	});
});
