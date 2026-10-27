import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Flat ESLint 9 config. The legacy .eslintrc.json is kept for older editors
 * but ESLint 9 no longer reads it.
 */
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
		files: ['test/**/*.{js,mjs,cjs}'],
		languageOptions: {
			sourceType: 'commonjs',
			globals: {
				// Explicit Mocha globals (globals.mocha also claims `run`,
				// which collides with test/suite/index.js).
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
