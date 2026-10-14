// Mutation tests of the submit outcome classifier, which
// decides when the SDK may tell a caller "rejected before
// admission", and of the problem parser beside it. Run with `npm run test:mutation`; not part
// of `npm test`.
export default {
  testRunner: 'mocha',
  // pnpm's isolated node_modules hides the runner from
  // Stryker's plugin auto-discovery.
  plugins: ['@stryker-mutator/mocha-runner'],
  mochaOptions: {
    config: '.mocharc.js',
    spec: [
      'src/api/__test__/problem.test.ts',
      'src/api/__test__/apiProblem.test.ts',
      'src/api/__test__/classify.test.ts',
      'src/api/__test__/submit.test.ts'
    ]
  },
  mutate: ['src/api/problem.ts', 'src/api/classify.ts'],
  coverageAnalysis: 'perTest',
  thresholds: { high: 95, low: 90, break: 90 },
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  tempDirName: '.stryker-tmp'
};
