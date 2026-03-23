import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      'build/',
      'configs/',
      'es/',
      'lib/',
      'dist/',
      'server/',
      'demo/',
      'node_modules/',
      'src/**/__test__/',
      'src/.umi',
      '*.config.js',
      '*.config.mjs',
      '*.conf.js',
      'mocha.tsx.js',
      'commitlint.config.js',
    ],
  },

  // Base configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Main source config
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/consistent-type-assertions': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/explicit-member-accessibility': 'warn',

      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',

      // Core ESLint
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'prefer-spread': 'warn',
      'no-unused-vars': 'off',
    },
  },

  // Integration tests override
  {
    files: ['src/__integration__/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  },

  // Prettier (must be last — disables conflicting rules + adds prettier plugin)
  eslintPluginPrettierRecommended,

  // Custom prettier options
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'prettier/prettier': [
        'warn',
        {
          printWidth: 50,
          tabWidth: 2,
          singleQuote: true,
          jsxSingleQuote: true,
          semi: true,
          trailingComma: 'none',
          endOfLine: 'auto',
          arrowParens: 'avoid',
          rangeEnd: 0,
        },
      ],
    },
  },
);
