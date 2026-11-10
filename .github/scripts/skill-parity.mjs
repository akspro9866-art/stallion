#!/usr/bin/env node
// CI: skills shared across the cavalry-mcp / stallion / refclone stack have one
// canonical home, cavalry-mcp/.qoder/skills. This repo keeps its local copies
// for the agents that load them; when a cavalry-mcp checkout is available
// (CAVALRY_MCP_PATH / CAVALRY_MCP_DIR, or a sibling ../cavalry-mcp) every shared
// skill directory is compared byte-for-byte. Without the checkout the sibling
// comparison is skipped, never faked.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SOURCE = path.join(ROOT, '.qoder', 'skills')
let failures = 0

const names = (await fs.readdir(SOURCE, { withFileTypes: true }))
	.filter(entry => entry.isDirectory())
	.map(entry => entry.name)
	.sort()
if (names.length === 0) {
	console.error('skill-parity: no skills found, which is not expected.')
	process.exit(1)
}
for (const name of names) {
	try {
		await fs.access(path.join(SOURCE, name, 'SKILL.md'))
	} catch {
		failures++
		console.error(`skill-parity: ${name} has no SKILL.md.`)
	}
}

async function walk(directory, prefix = '') {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	const files = []
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative))
		else if (entry.isFile()) files.push(relative)
	}
	return files.sort()
}

async function resolveCanonicalSkills() {
	const candidates = [
		process.env.CAVALRY_MCP_PATH,
		process.env.CAVALRY_MCP_DIR,
		path.join(ROOT, '..', 'cavalry-mcp')
	].filter(Boolean)
	for (const candidate of candidates) {
		const skills = path.join(path.resolve(candidate), '.qoder', 'skills')
		try {
			const entries = await fs.readdir(skills, { withFileTypes: true })
			if (entries.some(entry => entry.isDirectory())) return skills
		} catch {
			// try the next candidate
		}
	}
	return null
}

const canonical = await resolveCanonicalSkills()
if (!canonical) {
	console.log('skill-parity: canonical cavalry-mcp skills not available; sibling comparison skipped')
} else {
	const canonicalNames = new Set((await fs.readdir(canonical, { withFileTypes: true }))
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name))
	const shared = names.filter(name => canonicalNames.has(name))
	const localOnly = names.filter(name => !canonicalNames.has(name))
	let matched = 0
	for (const name of shared) {
		const localRoot = path.join(SOURCE, name)
		const canonicalRoot = path.join(canonical, name)
		const [localFiles, canonicalFiles] = await Promise.all([walk(localRoot), walk(canonicalRoot)])
		const localSet = new Set(localFiles)
		const canonicalSet = new Set(canonicalFiles)
		let skillFailures = 0
		for (const relative of localFiles) {
			if (!canonicalSet.has(relative)) {
				failures++
				skillFailures++
				console.error(`skill-parity: ${name}/${relative} is not part of canonical ${canonical}; synchronise the copy.`)
				continue
			}
			const [a, b] = await Promise.all([
				fs.readFile(path.join(localRoot, relative)),
				fs.readFile(path.join(canonicalRoot, relative))
			])
			if (!a.equals(b)) {
				failures++
				skillFailures++
				console.error(`skill-parity: ${name}/${relative} differs from canonical ${canonical}; synchronise the copy.`)
			}
		}
		for (const relative of canonicalFiles) {
			if (!localSet.has(relative)) {
				failures++
				skillFailures++
				console.error(`skill-parity: ${name}/${relative} is missing from the local copy of canonical skill ${name}.`)
			}
		}
		if (skillFailures === 0) matched++
	}
	const note = localOnly.length ? ` (${localOnly.length} local-only: ${localOnly.join(', ')})` : ''
	console.log(`skill-parity: ${matched}/${shared.length} shared skills match canonical cavalry-mcp/.qoder/skills${note}`)
}
process.exit(failures ? 1 : 0)
