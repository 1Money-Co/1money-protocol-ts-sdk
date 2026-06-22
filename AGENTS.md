# AGENTS.md

This file provides guidance to CODE AGENT when working with code in this repository.

## Keeping Docs & Skills in Sync (required)

**Any code change that adds or alters public behavior MUST update the docs and the
`skills/1money-protocol-sdk` skill in the same change.** The skill is what teaches
agents to consume the SDK correctly — stale skill content produces wrong code.

Update the matching file(s) when you touch:

| Code change | Update |
| --- | --- |
| Read endpoint added/changed (`src/api/**`) | `skills/1money-protocol-sdk/references/api-reference.md` |
| Transaction builder or signing changed (`src/signing/**`) | `skills/1money-protocol-sdk/references/transactions.md` |
| Client/promise-wrapper, error, config, network, or utils (`src/client/**`, `src/utils/**`) | `skills/1money-protocol-sdk/references/client-and-errors.md` |
| New/removed public export or import subpath (`src/index.ts`, `/api`, `/client`, `/utils`) | `skills/1money-protocol-sdk/SKILL.md` (the import map + builder→endpoint table) |
| Commands, architecture, or conventions | this `AGENTS.md` (and the module `README.md`) |

Checklist before opening a PR: function signatures, the builder→endpoint table in
`SKILL.md`, enum values, and code examples still match the source. Also update the
affected module `README.md` and `src/__integration__/QUICKSTART.md` if the public
flow changed.

## Development Commands

### Building
- `npm run build` - Build the project using omni build tool (generates lib/, es/, and umd/ directories)
- `npm run build:remote` - Build for remote deployment with RUN_ENV=remote

### Testing
- `npm test` - Run unit tests (nyc + Mocha, config `.mocharc.js`)
- `npm run test:integration` - Run integration tests against a live network
  (`.mocharc.integration.js`, requires `RUN_INTEGRATION_TESTS=true`)
- `npm run test:integration:testnet` / `:local` - Pin the integration network
- `npm run test:all` - Unit + integration
- Unit tests live in `src/**/__test__/*.ts`; integration suite in `src/__integration__/`
  (see its `QUICKSTART.md`)
- TS is loaded via `mocha.tsx.js` (tsx CJS transform) + `tsconfig-paths/register`;
  `.mocharc.js` disables Node 22 strip-types so tsx resolves paths correctly

### Linting & Code Quality
- `npm run lint` - Run both Prettier and ESLint checks
- `npm run lint:fix` - Auto-fix Prettier and ESLint issues
- `npm run lint:es` - ESLint TypeScript files in src/
- `npm run lint:prettier` - Check Prettier formatting
- Individual fix commands: `lint:es_fix`, `lint:prettier_fix`

### Development Workflow
- `npm run new` - Generate new components using omni CLI
- `npm run release` - Release package using omni tool

## Project Architecture

This is a TypeScript SDK for the 1Money Network Protocol with a modular architecture:

### Core Structure
- **src/index.ts** - Main entry point, exports api client and utilities
- **src/api/** - API client modules for different endpoints (accounts, tokens, transactions, checkpoints, chain)
- **src/client/** - Core HTTP client with promise wrapper system
- **src/signing/** - Transaction signing: EIP-712 (`eip712/`), payload `builders/`, `signer.ts`, `core.ts`
- **src/utils/** - Helpers: address derivation, tx hashing, `encode.ts`, `memo/`

### Key Architecture Patterns

#### API Client Pattern
The main `api()` function creates a configured client that returns typed API modules. It supports:
- Network selection (mainnet/testnet/local) with automatic base URL switching
- Configurable timeouts
- Modular API endpoints (accounts, tokens, transactions, checkpoints, chain)

#### Promise Wrapper System
Uses a custom promise wrapper in `src/client/core.ts` that provides:
- `.success()`, `.error()`, `.timeout()`, `.rest()` handlers
- Support for both traditional promise chains and async/await
- Structured error handling with typed responses

#### Module Organization
Each API module (accounts, tokens, etc.) has:
- `index.ts` - API methods
- `types.ts` - TypeScript interfaces
- `__test__/index.test.ts` - Unit tests
- `README.md` - Module documentation

### Build System
- Uses **omni-door CLI** for build orchestration
- **Rollup** for bundling with multiple output formats:
  - CommonJS (`lib/`)
  - ES Modules (`es/`)
  - UMD bundle (`umd/1money-protocol-ts-sdk.min.js`)
- **tsc-alias** for path alias resolution
- External dependencies: axios, viem, @ethereumjs/rlp (peer dependencies)

### TypeScript Configuration
- Target: ESNext with strict mode enabled
- Path aliases: `@/*` maps to `src/*`
- Generates declaration files (.d.ts)
- Excludes test files from compilation

### Testing Strategy
- Uses Mocha with nyc for coverage
- Tests located alongside source files in `__test__/` directories
- Supports both TypeScript and JavaScript test files
- 60-second timeout for async operations

## Code Style & Commits

- Prettier (`prettier.config.js`): 2-space, **printWidth 50**, single quotes,
  no trailing commas, `arrowParens: avoid`, semicolons on.
- ESLint (`@typescript-eslint`) over `src/`.
- Commits follow conventional format `type(scope): summary`; allowed types are in
  `commitlint.config.js` (`feat`, `fix`, `chore`, `optimize`, `[1MONEY-PROTOCOL-TS-SDK]`, …).
- Husky hooks run automatically: `pre-commit` → lint-staged, `commit-msg` → `npm run lint:commit`,
  plus a `pre-push` check. Don't bypass them.
