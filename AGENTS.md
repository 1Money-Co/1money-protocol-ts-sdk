# Repository Guidelines

## Project Structure & Module Organization
Core TypeScript sources live in `src/`, with domain folders for `api/`, `client/`, and shared `utils/`. Entry points such as `src/index.ts` stitch those modules together, while accompanying specs sit in sibling `__test__` directories (`src/api/tokens/__test__/index.test.ts`, etc.). Compiled artifacts are emitted to `es/` (ESM), `lib/` (CJS), and `umd/` for CDN usage, so never edit those outputs directly. Reference assets reside in `public/`, examples in `examples/`, and longer-form docs in `docs/`. Build behavior is centralized in `omni.config.js`, bundling tweaks in `rollup.config.js`, and TypeScript settings in `tsconfig.json`.

## Build, Test & Development Commands
Use your preferred package manager, but stay consistent per branch.
```bash
pnpm install            # or npm install – install dev + peer tooling
npm run build           # omni build -> emits es/lib/umd bundles
npm run build:remote    # same build with RUN_ENV=remote for hosted targets
npm test                # nyc + mocha using .mocharc.js
npm run lint            # prettier check + eslint (ts/tsx)
npm run lint:fix        # applies prettier/eslint autofixes
```
Run linting before opening a PR; CI expects clean output directories.

## Coding Style & Naming Conventions
The repo enforces `.editorconfig` (LF, UTF-8, two-space indents) and `prettier.config.js` (tabWidth 2, printWidth 50, single quotes, arrowParens `avoid`, trailing commas `none`). ESLint runs with `@typescript-eslint` rules over `src/**`. Prefer descriptive module exports (`api/checkpoints`, `client/rpc`) and keep test files named `*.test.ts`. Public APIs should expose camelCase functions, PascalCase classes, and never leak internal helper names.

## Testing Guidelines
All specs use Mocha + Chai and live beside their subjects (`__test__/`). Structure tests as `describe('<module>')` blocks with explicit success/error cases that mirror the SDK’s `.success/.timeout/.error` flow. Execute `npm test` locally; NYC writes reports to `.nyc_output/` and enforces the existing coverage baselines, so add scenarios rather than loosening thresholds. When adding a module, stub network calls and favor deterministic fixtures.

## Commit & Pull Request Guidelines
Commitlint extends the conventional config with allowed types such as `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, plus the project tag `[1MONEY-PROTOCOL-TS-SDK]`. Format messages as `type(scope): summary`, e.g., `feat(api): add token metadata endpoint`. Before pushing, run `npm run lint && npm test` and ensure generated bundles are excluded from diffs. PRs should describe the change, list validation commands, link related issues, and include API or screenshot evidence when touching user-facing behavior.

## Security & Configuration Tips
Never commit `.env` values; tests should rely on mocked data or public endpoints. When debugging against live protocol nodes, set `RUN_ENV=remote` only in your shell and prefer the `testnet` client configuration shown in `README.md`. Audit dependencies before enabling new wallets or transports, and keep peer versions (`axios`, `viem`, `@ethereumjs/rlp`) aligned with the ranges declared in `package.json`.
