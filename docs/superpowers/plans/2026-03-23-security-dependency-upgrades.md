# Security Dependency Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 23 open Dependabot security alerts by upgrading devDependencies to latest major versions and dismissing acceptable low-risk alerts.

**Architecture:** All vulnerabilities are in devDependencies only — none affect the published SDK. The fix involves upgrading 6 direct devDependencies (rollup, puppeteer, @rollup/plugin-terser, mocha, @commitlint/cli, eslint) with associated config migrations, then dismissing remaining acceptable alerts.

**Tech Stack:** pnpm, ESLint 9 (flat config), Mocha 11, Commitlint 20, Rollup 4.60+, TypeScript 5.8

---

### Task 1: Upgrade rollup, puppeteer, and @rollup/plugin-terser (no config changes)

These are simple version bumps with no breaking config changes.

**Files:**
- Modify: `package.json:108` (rollup version)
- Modify: `package.json:107` (puppeteer version)
- Modify: `package.json:84` (plugin-terser version)

- [ ] **Step 1: Update versions in package.json**

Change these three devDependencies in `package.json`:

```json
"@rollup/plugin-terser": "^1.0.0",
"puppeteer": "^24.40.0",
"rollup": "~4.60.0",
```

- [ ] **Step 2: Install updated dependencies**

Run: `pnpm install`
Expected: Clean install with updated lockfile, no peer dep errors.

- [ ] **Step 3: Verify build still works**

Run: `npm run build`
Expected: Build completes successfully, generates `lib/`, `es/`, `umd/` directories.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade rollup, puppeteer, @rollup/plugin-terser for security fixes"
```

---

### Task 2: Upgrade Mocha from v10 to v11

Mocha v11 changed how loaders are registered. The `require` config option still works in v11 for CJS loaders, but we should verify compatibility.

**Files:**
- Modify: `package.json:103` (mocha version)

- [ ] **Step 1: Update mocha version in package.json**

Change in `package.json`:

```json
"mocha": "11.7.5",
```

- [ ] **Step 2: Install updated dependencies**

Run: `pnpm install`
Expected: Clean install.

- [ ] **Step 3: Verify tests pass**

Run: `npm test`
Expected: All tests pass. The `.mocharc.js` uses `require: ['mocha.tsx.js', 'tsconfig-paths/register']` which should still work in Mocha 11 since `mocha.tsx.js` uses CJS `require('tsx/cjs/api').register()`.

- [ ] **Step 4: Verify integration test config is also compatible**

Run: `npm run test:integration:testnet` (or just inspect that `.mocharc.integration.js` uses the same `require` pattern — it does, so if step 3 passes, this is fine).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade mocha to v11 for security fixes"
```

---

### Task 3: Upgrade @commitlint/cli from v8 to v20

Commitlint v20 requires `@commitlint/config-conventional` as a base config (v8 had it built-in). The config file format is the same but needs an `extends` field.

**Files:**
- Modify: `package.json:75` (commitlint version)
- Modify: `commitlint.config.js`

- [ ] **Step 1: Update package.json**

Replace `@commitlint/cli` and add `@commitlint/config-conventional`:

In devDependencies, change:
```json
"@commitlint/cli": "~20.5.0",
"@commitlint/config-conventional": "~20.5.0",
```

Remove the old `"@commitlint/cli": "8.3.5"` line.

- [ ] **Step 2: Update commitlint.config.js**

Replace the entire file with:

```js
'use strict';

const Configuration = {
  extends: ['@commitlint/config-conventional'],
  formatter: '@commitlint/format',
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
      'chore'
    ]]
  },
  ignores: [
    commit => {
      const regExp = /^Merge branch.+/;
      return regExp.test(commit);
    }
  ],
  defaultIgnores: true
};

module.exports = Configuration;
```

The only change is adding `extends: ['@commitlint/config-conventional']`.

- [ ] **Step 3: Update the husky commit-msg hook**

The current `.husky/commit-msg` runs `npm run lint:commit`. The `package.json` script is:
```json
"lint:commit": "commitlint -e $HUSKY_GIT_PARAMS"
```

In commitlint v20, the env var approach changed. Update `package.json` script:
```json
"lint:commit": "commitlint --edit"
```

- [ ] **Step 4: Install updated dependencies**

Run: `pnpm install`
Expected: Clean install.

- [ ] **Step 5: Verify commitlint works**

Run: `echo "feat: test commit" | npx commitlint`
Expected: No errors (valid commit message).

Run: `echo "invalid commit" | npx commitlint`
Expected: Error about type not being one of the allowed types.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml commitlint.config.js
git commit -m "chore: upgrade commitlint to v20 for security fixes"
```

---

### Task 4: Migrate ESLint from v8 to v9 (flat config)

This is the largest change. ESLint v9 uses "flat config" (`eslint.config.mjs`) instead of `.eslintrc.js` + `.eslintignore`. The `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` packages are replaced by the unified `typescript-eslint` package.

**Files:**
- Delete: `.eslintrc.js`
- Delete: `.eslintignore`
- Delete: `src/__integration__/.eslintrc.json`
- Create: `eslint.config.mjs`
- Modify: `package.json` (devDependencies + lint scripts)

- [ ] **Step 1: Update package.json devDependencies**

Remove these packages:
```
"@typescript-eslint/eslint-plugin": "~8.30.0",
"@typescript-eslint/parser": "~8.30.0",
"eslint": "~8.57.1",
"eslint-config-prettier": "~10.0.1",
"eslint-plugin-prettier": "~5.2.3",
```

Add these packages:
```json
"@eslint/js": "~10.0.1",
"eslint": "~9.23.0",
"eslint-config-prettier": "~10.1.8",
"eslint-plugin-prettier": "~5.5.5",
"typescript-eslint": "~8.57.1",
```

- [ ] **Step 2: Update lint scripts in package.json**

Replace:
```json
"lint:es": "eslint src/ --ext .ts --ext .tsx",
"lint:es_fix": "eslint src/ --ext .ts --ext .tsx --fix",
```

With:
```json
"lint:es": "eslint src/",
"lint:es_fix": "eslint src/ --fix",
```

ESLint v9 no longer uses `--ext` flags; file extensions are configured in the flat config.

- [ ] **Step 3: Create eslint.config.mjs**

Create `eslint.config.mjs` with the following content:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

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
    plugins: {
      prettier,
    },
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
      // Prettier
      ...prettierConfig.rules,
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

      // TypeScript
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/consistent-type-assertions': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/explicit-member-accessibility': 'warn',

      // Core ESLint
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      semi: ['error', 'always'],
      'prefer-spread': 'warn',
      'no-unused-vars': 'off',
      'no-extra-semi': 'warn',
      quotes: ['error', 'single'],
      'linebreak-style': ['warn', 'unix'],
    },
  },

  // Integration tests override
  {
    files: ['src/__integration__/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  }
);
```

Key migration notes:
- `@typescript-eslint/camelcase` was removed in typescript-eslint v6 — drop it.
- `@typescript-eslint/no-angle-bracket-type-assertion` was removed — drop it.
- `@typescript-eslint/interface-name-prefix` was removed — drop it.
- `@typescript-eslint/no-empty-interface` replaced by `@typescript-eslint/no-empty-object-type` in v8 — disable both.
- `plugin:prettier/recommended` is replaced by manually importing the plugin and config.
- Browser globals (`Atomics`, `SharedArrayBuffer`) are set explicitly since `env` is gone.

- [ ] **Step 4: Delete old config files**

Delete these files:
- `.eslintrc.js`
- `.eslintignore`
- `src/__integration__/.eslintrc.json`

- [ ] **Step 5: Install updated dependencies**

Run: `pnpm install`
Expected: Clean install.

- [ ] **Step 6: Run linter to verify config works**

Run: `npm run lint:es`
Expected: Linter runs successfully with no new errors (existing warnings are fine).

If there are new errors from stricter defaults in typescript-eslint v8 recommended config, add specific rule overrides to suppress them.

- [ ] **Step 7: Run full lint check**

Run: `npm run lint`
Expected: Both prettier and eslint checks pass.

- [ ] **Step 8: Run build to make sure nothing is broken**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add eslint.config.mjs package.json pnpm-lock.yaml
git rm .eslintrc.js .eslintignore src/__integration__/.eslintrc.json
git commit -m "chore: migrate eslint to v9 flat config for security fixes"
```

---

### Task 5: Add pnpm overrides for remaining transitive vulnerabilities

After all direct upgrades, some transitive deps may still have vulnerabilities (e.g., `minimatch` in old `glob` versions pulled by `@omni-door/cli`). Use `pnpm.overrides` to force patched versions.

**Files:**
- Modify: `package.json` (add `pnpm.overrides` section)

- [ ] **Step 1: Check which alerts remain**

Run: `gh api repos/1Money-Co/1money-protocol-ts-sdk/dependabot/alerts --jq '.[] | select(.state == "open") | {number, package: .security_vulnerability.package.name, severity: .security_advisory.severity}'`

Identify which high/critical alerts remain after Tasks 1-4.

- [ ] **Step 2: Add pnpm overrides for remaining high/critical transitive deps**

Add to `package.json` at the top level:

```json
"pnpm": {
  "overrides": {
    "minimatch@<3.1.4": "3.1.4",
    "minimatch@>=5.0.0 <5.1.8": "5.1.8",
    "minimatch@>=9.0.0 <9.0.7": "9.0.7"
  }
}
```

Adjust the overrides based on which alerts actually remain after the direct upgrades. Only add overrides for packages that still show as vulnerable.

- [ ] **Step 3: Install to apply overrides**

Run: `pnpm install`
Expected: Lockfile updated with patched versions.

- [ ] **Step 4: Verify build and tests**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add pnpm overrides for transitive dependency security fixes"
```

---

### Task 6: Dismiss acceptable low/medium alerts

After all upgrades, dismiss remaining alerts that are acceptable risk (dev-only, not exploitable in this context).

**Files:** None (GitHub API only)

- [ ] **Step 1: List remaining open alerts**

Run: `gh api repos/1Money-Co/1money-protocol-ts-sdk/dependabot/alerts --jq '.[] | select(.state == "open") | {number, package: .security_vulnerability.package.name, severity: .security_advisory.severity}'`

- [ ] **Step 2: Dismiss low-severity alerts**

For each remaining low alert (e.g., `webpack`, `diff`), dismiss with reason:

```bash
gh api --method PATCH repos/1Money-Co/1money-protocol-ts-sdk/dependabot/alerts/ALERT_NUMBER -f state=dismissed -f dismissed_reason=tolerable_risk -f dismissed_comment="Dev-only dependency, not exploitable in SDK build context"
```

- [ ] **Step 3: Dismiss medium-severity alerts**

For each remaining medium alert (e.g., `ajv`, `lodash`, `js-yaml`), dismiss with reason:

```bash
gh api --method PATCH repos/1Money-Co/1money-protocol-ts-sdk/dependabot/alerts/ALERT_NUMBER -f state=dismissed -f dismissed_reason=tolerable_risk -f dismissed_comment="Dev-only transitive dependency, not exploitable in SDK build/lint context"
```

- [ ] **Step 4: Verify no critical or high alerts remain**

Run: `gh api repos/1Money-Co/1money-protocol-ts-sdk/dependabot/alerts --jq '.[] | select(.state == "open") | select(.security_advisory.severity == "critical" or .security_advisory.severity == "high") | {number, package: .security_vulnerability.package.name}'`

Expected: Empty output (no critical or high alerts remain open).

---

### Task 7: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Success.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Full lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Check alert summary**

Run: `gh api repos/1Money-Co/1money-protocol-ts-sdk/dependabot/alerts --jq '[.[] | select(.state == "open")] | length'`
Expected: 0 (no open alerts).

- [ ] **Step 5: Final commit if any cleanup needed, then push**

```bash
git push origin chore/security
```
