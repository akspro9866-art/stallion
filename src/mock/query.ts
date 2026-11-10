/**
 * GET introspection query parsing and inline-pixel opt-out (extracted from mock/server.ts; behaviour unchanged).
 */

/**
 * A `GET /state?frame=42&attrs=position.x,opacity` query into the same payload shape
 * `POST /post` accepts, so both surfaces reach one handler and cannot drift apart.
 * Unknown keys are ignored rather than rejected: a client asking for `?debug=1` should
 * still get its scene back.
 */
export function introspectQuery(url: URL, kind: 'state' | 'layers' | 'snapshot' | 'snapshot-batch'): Record<string, unknown> {
	const q = url.searchParams
	const pick = (...names: string[]): string | null => {
		for (const name of names) {
			const value = q.get(name)
			if (value !== null) return value
		}
		return null
	}
	const parsed: Record<string, unknown> = { type: kind, seq: pick('seq') ?? `get-${kind}-${Date.now()}` }
	const frame = pick('frame', 't')
	if (frame !== null) parsed.frame = frame
	if (kind === 'snapshot' || kind === 'snapshot-batch') {
		const scale = pick('scale', 'resolutionScale')
		if (scale !== null) parsed.scale = scale
		const outDir = pick('outDir', 'out')
		if (outDir !== null) parsed.outDir = outDir
		const fileName = pick('fileName', 'name')
		if (fileName !== null) parsed.fileName = fileName
		if (kind === 'snapshot-batch') {
			const frames = pick('frames')
			if (frames !== null) parsed.frames = frames.split(',').map((s) => s.trim()).filter(Boolean)
			const layerIds = pick('layerIds')
			if (layerIds !== null) parsed.layerIds = layerIds.split(',').map((s) => s.trim()).filter(Boolean)
			const attrs = pick('attrs')
			if (attrs !== null) parsed.attrs = attrs.split(',').map((s) => s.trim()).filter(Boolean)
			if (/^(1|true|yes)$/i.test(pick('includeHidden') ?? '')) parsed.includeHidden = true
		}
	} else {
		const offset = pick('offset')
		if (offset !== null) parsed.offset = offset
		const limit = pick('limit')
		if (limit !== null) parsed.limit = limit
		const budgetMs = pick('budgetMs', 'budget')
		if (budgetMs !== null) parsed.budgetMs = budgetMs
		const attrs = pick('attrs', 'attributes')
		if (attrs !== null) {
			// `?attrs=a,b` selects values; `?attributes=1` asks for every declared
			// attribute instead, so the two spellings must not be conflated.
			if (/^(1|true|yes)$/i.test(attrs)) parsed.attributes = true
			else parsed.attrs = attrs.split(',').map((s) => s.trim()).filter(Boolean)
		}
	}
	const comp = pick('comp', 'compId')
	if (comp !== null) parsed.compId = comp
	const mgCall = pick('mgCall')
	if (mgCall !== null) parsed.mgCall = mgCall
	return parsed
}

/**
 * Should a snapshot answer carry inline pixels? `?inline=0` or `{inline:false}`
 * turns them off: the file path, size and hashes are the contract, the bytes are a
 * convenience for callers that would otherwise poll the disk.
 */
export function inlineWanted(parsed: Record<string, unknown>, url: URL): boolean {
	const value = parsed.inline ?? url.searchParams.get('inline') ?? '1'
	return value !== false && !/^(0|false)$/i.test(String(value))
}
