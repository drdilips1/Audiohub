// Lint: catches mistakes (a name that doesn't exist, an import never used…), not style.
// Run with: npm run lint
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['dist/**', 'android/**', 'ios/**', 'node_modules/**', 'workers/**', 'relay/**', 'public/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react },
    settings: { react: { pragma: 'h', version: '18.0' } },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, __APP_VERSION__: 'readonly', __BUILD_TIME__: 'readonly' },
    },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'warn',
      'no-self-assign': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-const-assign': 'error',
      'no-import-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
