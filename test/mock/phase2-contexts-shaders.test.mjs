/**
 * Phase 2 mock tests:
 * - 8 Cavalry 2.8.0 execution contexts & context-scoped global validation
 * - 9 expression/shader payload types (`javaScriptShape`, `javaScriptUtility`,
 *   `javaScriptModifier`, `javaScriptDeformer`, `javaScriptEmitter`, `skslShader`,
 *   `skslFilter`, `preRenderExpression`, `postRenderExpression`) with deterministic
 *   `seq`-matched receipts and `js_log.txt` diagnostic capture
 * - World-space & comp-space `api.getBoundingBox(id, true|false)` geometry readback
 * - SkSL shader creation, uniform auto-registration, and material/filter attachment
 * - Dynamic attribute registration (`api.addDynamic` / `api.addDynamicAttribute`)
 *   and live value propagation across `api.connect`
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
	CAVALRY_EXECUTION_CONTEXTS,
	CONTEXT_GLOBALS_BY_CONTEXT,
	EXPRESSION_PAYLOAD_TYPES,
	captureJsLogDiagnostics,
	isExpressionPayloadType,
	payloadTypeToExecutionContext,
	startMockServer,
	validateCavalryContextUsage,
	validateSkslSource,
} from '../../dist/stallion-mock.mjs'

async function withServer(fn, options = {}) {
	const handle = await startMockServer({ port: 0, ...options })
	try {
		return await fn(handle, {
			post: async (payload) => {
				const response = await fetch(`http://127.0.0.1:${handle.port}/post`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				})
				assert.equal(response.status, 200)
				return response.json()
			},
			get: async () => (await fetch(`http://127.0.0.1:${handle.port}/get`)).json(),
			run: async (code, extra = {}) => {
				const seq = `seq-${Math.random().toString(36).slice(2)}`
				await fetch(`http://127.0.0.1:${handle.port}/post`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ type: 'script', seq, code, ...extra }),
				})
				const envelope = await (await fetch(`http://127.0.0.1:${handle.port}/get`)).json()
				return { seq, envelope }
			},
		})
	} finally {
		await handle.close()
	}
}

test('all 8 Cavalry 2.8.0 execution contexts validate allowed and forbidden globals', () => {
	assert.deepEqual([...CAVALRY_EXECUTION_CONTEXTS], [
		'script',
		'plugin',
		'render',
		'shape',
		'utility',
		'deformer',
		'emitter',
		'modifier',
	])
	assert.ok(CONTEXT_GLOBALS_BY_CONTEXT.deformer.includes('def'))
	assert.ok(CONTEXT_GLOBALS_BY_CONTEXT.render.includes('render'))
	assert.ok(CONTEXT_GLOBALS_BY_CONTEXT.plugin.includes('install'))

	// Valid shape context usage (ctx + cavalry)
	const validShape = validateCavalryContextUsage(
		'var p = new cavalry.Path(); var f = ctx.frame; return p;',
		'javaScriptShape',
	)
	assert.equal(validShape.valid, true)
	assert.equal(validShape.context, 'shape')
	assert.equal(validShape.forbiddenUsages.length, 0)

	// Invalid shape context usage (api.create and ui.show are not available in shape context)
	const invalidShape = validateCavalryContextUsage(
		'var id = api.create("basicShape"); ui.show(); return new cavalry.Path();',
		'javaScriptShape',
	)
	assert.equal(invalidShape.valid, false)
	assert.deepEqual(invalidShape.forbiddenUsages, ['api.create', 'ui.show'])
	assert.equal(invalidShape.diagnostics.length, 2)

	// Valid deformer context usage (def + ctx + cavalry)
	const validDeformer = validateCavalryContextUsage(
		'var pts = def.getPoints(); var n = ctx.index; return pts;',
		'javaScriptDeformer',
	)
	assert.equal(validDeformer.valid, true)
	assert.equal(validDeformer.context, 'deformer')

	// Valid render context usage (api + render + console)
	const validRender = validateCavalryContextUsage(
		'console.log(render.frame); api.getActiveComp();',
		'preRenderExpression',
	)
	assert.equal(validRender.valid, true)
	assert.equal(validRender.context, 'render')
})

test('all 9 expression and shader payload types return deterministic seq-matched receipts and js_log.txt diagnostics', async () => {
	assert.equal(EXPRESSION_PAYLOAD_TYPES.length, 9)
	for (const pt of EXPRESSION_PAYLOAD_TYPES) {
		assert.equal(isExpressionPayloadType(pt), true)
	}

	await withServer(async (handle, client) => {
		const samplePayloads = {
			javaScriptShape: 'var p = new cavalry.Path(); return p;',
			javaScriptUtility: 'return ctx.frame * 2.0;',
			javaScriptModifier: 'return ctx.value * 0.5;',
			javaScriptDeformer: 'var pts = def.getPoints(); return pts;',
			javaScriptEmitter: 'return ctx.index * 10;',
			skslShader: 'uniform float uTime;\nhalf4 main(float2 fragCoord) { return half4(uTime, 0.5, 0.8, 1.0); }',
			skslFilter: 'uniform shader inputShader;\nhalf4 main(float2 fragCoord) { return half4(1.0); }',
			preRenderExpression: 'console.log("pre-render", render.frame);',
			postRenderExpression: 'console.log("post-render", render.outputPath);',
		}

		for (const payloadType of EXPRESSION_PAYLOAD_TYPES) {
			// Clear selection so each javaScript*/sksl* auto-creates its node cleanly
			handle.api.select([])
			const seq = `expr-${payloadType}`
			await client.post({
				type: payloadType,
				seq,
				code: samplePayloads[payloadType],
				beatFrames: [0, 12],
			})
			const env = await client.get()
			assert.equal(env.kind, 'result')
			assert.equal(env.seq, seq)
			assert.equal(env.ok, true)
			assert.ok(Array.isArray(env.applied) && env.applied.length >= 1, `expected applied layer for ${payloadType}`)
			assert.ok(env.receipt, `expected receipt for ${payloadType}`)
			assert.equal(env.receipt.payloadType, payloadType)
			assert.equal(env.receipt.context, payloadTypeToExecutionContext(payloadType))
			assert.equal(env.receipt.valid, true)
			assert.match(env.receipt.sceneStateHash, /^[0-9a-f]{16}$/)
		}

		// Verify js_log.txt diagnostic capture when an expression uses a forbidden namespace
		handle.api.select([])
		await client.post({
			type: 'javaScriptUtility',
			seq: 'expr-bad-ctx',
			code: 'api.set("foo#1", {}); return 1;',
		})
		const badEnv = await client.get()
		assert.equal(badEnv.seq, 'expr-bad-ctx')
		assert.equal(badEnv.receipt.valid, false)
		assert.ok(badEnv.receipt.consoleDiagnostics.some((d) => d.text.includes("does not expose 'api'")))
		const logEntries = captureJsLogDiagnostics(handle.api.getJsLogPath())
		assert.ok(logEntries.some((d) => d.level === 'error' && d.text.includes("does not expose 'api'")))
	})
})

test('world-space and comp-space getBoundingBox readback includes left/right/top/bottom, centre, radius, text, and scale', async () => {
	await withServer(async (_handle, client) => {
		const { envelope } = await client.run(`
			var circle = api.primitive('ellipse', 'Orb');
			api.set(circle, {
				'generator.radius': [60, 40],
				'position.x': 150,
				'position.y': -80,
				'scale.x': 2,
				'scale.y': 1.5
			});
			var worldBox = api.getBoundingBox(circle, true);
			var localBox = api.getBoundingBox(circle, false);

			var label = api.create('textShape', 'Headline');
			api.set(label, {
				'text': 'Stallion 2.8',
				'fontSize': 48,
				'position.x': 0,
				'position.y': 100
			});
			var textBox = api.getBoundingBox(label, true);
			return { worldBox: worldBox, localBox: localBox, textBox: textBox };
		`)
		assert.equal(envelope.ok, true)
		const { worldBox, localBox, textBox } = envelope.result
		// radius [60, 40] => base diameter [120, 80], scaled by [2, 1.5] => [240, 120]
		assert.equal(worldBox.width, 240)
		assert.equal(worldBox.height, 120)
		assert.equal(worldBox.centre.x, 150)
		assert.equal(worldBox.centre.y, -80)
		assert.equal(worldBox.left, 30)
		assert.equal(worldBox.right, 270)
		assert.equal(worldBox.top, -140)
		assert.equal(worldBox.bottom, -20)

		assert.equal(localBox.width, 240)
		assert.equal(localBox.height, 120)
		assert.equal(localBox.centre.x, 150)
		assert.equal(localBox.centre.y, -80)

		assert.ok(textBox.width > 100)
		assert.ok(textBox.height >= 48)
		assert.equal(textBox.centre.y, 100)
	})
})

test('SkSL shader creation, uniform auto-registration, validation, and material/filter attachment', async () => {
	const check = validateSkslSource(`
		uniform float uProgress;
		uniform vec3 uAccent;
		half4 main(float2 fragCoord) {
			return half4(uAccent * uProgress, 1.0);
		}
	`)
	assert.equal(check.valid, true)
	assert.deepEqual(check.uniforms, [
		{ type: 'float', name: 'uProgress' },
		{ type: 'vec3', name: 'uAccent' },
	])

	await withServer(async (handle, client) => {
		const { envelope } = await client.run(`
			var card = api.primitive('rectangle', 'HeroCard');
			return card;
		`)
		const cardId = envelope.result
		handle.api.select([])
		await client.post({
			type: 'skslShader',
			seq: 'sksl-attach-1',
			attachTo: cardId,
			code: 'uniform float uGlow;\nhalf4 main(float2 fragCoord) { return half4(uGlow, 0.2, 0.8, 1.0); }',
		})
		const shaderEnv = await client.get()
		assert.equal(shaderEnv.ok, true)
		assert.equal(shaderEnv.receipt.valid, true)
		assert.deepEqual(shaderEnv.receipt.uniforms, [{ type: 'float', name: 'uGlow' }])
		const shaderId = shaderEnv.applied[0]
		assert.equal(handle.api.getInConnection(cardId, 'material.shader'), `${shaderId}.id`)

		// Verify uniform attribute was auto-registered and can be animated/set without schema rejection
		const { envelope: setUniformEnv } = await client.run(`
			api.set(${JSON.stringify(shaderId)}, { 'uniforms.uGlow': 0.85 });
			return api.get(${JSON.stringify(shaderId)}, 'uniforms.uGlow');
		`)
		assert.equal(setUniformEnv.ok, true)
		assert.equal(setUniformEnv.result, 0.85)
		assert.equal(setUniformEnv.receipt.consoleDiagnostics.length, 0)
	})
})

test('dynamic attribute connections (addDynamic / addDynamicAttribute) propagate live values via api.get', async () => {
	await withServer(async (_handle, client) => {
		const { envelope } = await client.run(`
			var util = api.create('javaScriptUtility', 'Driver');
			var dynPath = api.addDynamicAttribute(util, 'driveVal', 'double', 42.5);
			var valNode = api.create('value', 'PassThrough');
			api.set(valNode, { 'value': 99.25 });
			var card = api.primitive('rectangle', 'DrivenCard');
			api.addDynamic(card, 'array');
			api.connect(valNode, 'id', card, 'position.x');
			api.connect(util, dynPath, card, 'position.y');
			return {
				dynPath: dynPath,
				posX: api.get(card, 'position.x'),
				posY: api.get(card, 'position.y')
			};
		`)
		assert.equal(envelope.ok, true)
		assert.equal(envelope.result.dynPath, 'dynamic.driveVal')
		assert.equal(envelope.result.posX, 99.25)
		assert.equal(envelope.result.posY, 42.5)
	})
})
