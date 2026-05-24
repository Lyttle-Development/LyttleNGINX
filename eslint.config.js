const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierPlugin = require('eslint-plugin-prettier');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.eslintrc.js'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['tsconfig.json', 'tsconfig.test.json'],
        tsconfigRootDir: __dirname,
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...eslintConfigPrettier.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
