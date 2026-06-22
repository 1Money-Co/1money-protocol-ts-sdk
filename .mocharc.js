module.exports = {
  color: true,
  diff: true,
  require: [
    'mocha.tsx.js',
    'tsconfig-paths/register'
  ],
  extension: ['ts', 'js'],
  reporter: 'spec',
  spec: ['src/**/__test__/*.ts'],
  slow: '75',
  timeout: '60000',
  ui: 'bdd',
  // Disable Node 22's built-in TypeScript strip-only mode so that tsx's
  // CJS transform (registered in mocha.tsx.js) handles all .ts files.
  // Without this, Node 22 intercepts .ts ESM imports before tsx can act,
  // causing confusing ERR_MODULE_NOT_FOUND / ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
  // errors instead of the real module-resolution failures.
  'node-option': ['no-experimental-strip-types']
};
