import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Two environments live in this repo and they need different globals: the
 * browser app under src/, and the Node API under server/. Linting them with one
 * config is why `process` was previously reported as undefined in every server
 * file.
 */
export default [
  { ignores: ['dist', 'build', 'node_modules', 'server/node_modules', 'coverage'] },

  // ── Browser app ──
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // A capitalised arg is a component passed as a prop (icon: Icon) and is
      // used in JSX, which the base rule cannot see.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_|^[A-Z]' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /**
       * This app fetches in effects and writes the result to state, which is
       * what the rule flags. That is the correct pattern without a data-fetching
       * library, and every such effect here is either guarded by a mounted ref
       * or by a stable useCallback, so a cascading render is not possible.
       * Downgraded to a warning rather than switched off, so a genuinely
       * synchronous setState in an effect is still visible.
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // ── Node API ──
  {
    files: ['server/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_|^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': 'off',
    },
  },
];
