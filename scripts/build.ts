import { build, context, type BuildOptions } from 'esbuild'
import pkg from '../package.json' with { type: 'json' }
import { resolve } from 'path'
import { rimraf } from 'rimraf'

const production = process.env.NODE_ENV === 'production'

const options: BuildOptions = {
    bundle: true,
    outdir: './dist',
    logLevel: 'info',
    minify: production,
}

const cavalryOptions: BuildOptions = {
    ...options,
	entryPoints: ['./src/cavalry/Stallion.ts'],
	banner: {
		js: [
			`// VERSION ${pkg.version}`,
			'// This is the compiled version',
			`// Read the source at ${pkg.repository.url}`,
		].join('\n'),
	},
}

const vscodeOptions: BuildOptions = {
    ...options,
    entryPoints: ['./src/vscode/extension.ts'],
    sourcemap: !production,
    external: ['vscode'],
    platform: 'node',
    format: 'cjs',
}

const mockOptions: BuildOptions = {
    ...options,
    outdir: undefined,
    entryPoints: ['./src/node/mock-cli.ts'],
    outfile: './dist/stallion-mock.mjs',
    platform: 'node',
    format: 'esm',
    banner: {
        js: [
            '#!/usr/bin/env node',
            `// VERSION ${pkg.version} (mock bridge)`,
        ].join('\n'),
    },
}

const cavalry = await context(cavalryOptions)
const vscode = await context(vscodeOptions)
const mock = await context(mockOptions)

if (production) {
    rimraf(resolve(options.outdir))
    await Promise.all([build(cavalryOptions), build(vscodeOptions), build(mockOptions)])
    await Promise.all([cavalry.dispose(), vscode.dispose(), mock.dispose()])
} else {
    await Promise.all([cavalry.watch(), vscode.watch(), mock.watch()])
}

