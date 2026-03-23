'use strict';

const Configuration = {
  extends: ['@commitlint/config-conventional'],
  formatter: '@commitlint/format',
  /*
    * Any rules defined here will override rules from @commitlint/config-conventional
    */
  rules: {
    'type-enum': [2, 'always', [
      '[1MONEY-PROTOCOL-TS-SDK]',
      'feat',
      'feature',
      'fix',
      'hotfix',
      'docs',
      'style',
      'refactor',
      'test',
      'revert',
      'update',
      'upgrade',
      'modify',
      'merge',
      'chore',
      'optimize',
      'perf',
    ]]
  },
  /*
    * Functions that return true if commitlint should ignore the given message.
    */
  ignores: [
    commit => {
      const regExp = /^Merge branch.+/;
      return regExp.test(commit);
    }
  ],
  /*
    * Whether commitlint uses the default ignore rules.
    */
  defaultIgnores: true
};

module.exports = Configuration;
