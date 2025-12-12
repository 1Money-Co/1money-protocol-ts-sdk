/**
 * Mocha configuration for integration tests
 */

module.exports = {
  color: true,
  diff: true,
  require: [
    'mocha.tsx.js',
    'tsconfig-paths/register'
  ],
  extension: ['ts', 'js'],
  reporter: 'spec',
  spec: ['src/__integration__/**/*.test.ts'],
  slow: '5000',
  timeout: '120000', // 2 minutes timeout for integration tests
  ui: 'bdd'
};
