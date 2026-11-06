import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Flat ESLint 9 config. ESLint 9 does not read `.eslintrc.json`. */
export default tseslint.config(
	{
		ignores: [
			'dist/**',
			'node_modules/**',
			'.vscode-test/**',
			'*.vsix',
			'cavalry-bridge-*.vsix',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.browser,
				// Cavalry's script globals are injected by the host.
				api: 'readonly',
				ui: 'readonly',
				cavalry: 'readonly',
			},
		},
		rules: {
			'no-const-assign': 'warn',
			'no-this-before-super': 'warn',
			'no-undef': 'warn',
			'no-unreachable': 'warn',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-unused-expressions': 'warn',
			'constructor-super': 'warn',
			'valid-typeof': 'warn',
		},
	},
	{
		files: ['**/*.ts'],
		rules: {
			// TypeScript already resolves identifiers and types.
			'no-undef': 'off',
		},
	},
	{
		// Mocha globals belong to the VS Code suite only; *.test.mjs files use
		// node:test's own `test` import and must not see a mocha `test` global.
		files: ['test/vscode/suite/**/*.{js,mjs,cjs}'],
		languageOptions: {
			sourceType: 'commonjs',
			globals: {
				// Explicit Mocha globals (globals.mocha also claims `run`,
				// which collides with test/vscode/suite/index.js).
				describe: 'readonly',
				it: 'readonly',
				before: 'readonly',
				after: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
				suite: 'readonly',
				test: 'readonly',
				setup: 'readonly',
				teardown: 'readonly',
				suiteSetup: 'readonly',
				suiteTeardown: 'readonly',
			},
		},
	},
)
