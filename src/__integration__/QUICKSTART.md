# Integration Tests Quick Start

## For Local Development

### 1. Start Local 1Money Network

Make sure you have a local 1Money network running. Refer to the main project documentation for setup instructions.

### 2. Run Integration Tests

```bash
# Quick start - run all integration tests on local network
npm run test:integration:local
```

## Example Output

When you run the integration tests, you'll see detailed output like this:

```
=== Integration Test Accounts ===
Operator: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Master: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
User1: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
User2: 0x90F79bf6EB2c4f870365E785982E1f101E93b906
User3: 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
=================================

============================================================
  Step 1: Issue Token
============================================================

→ Preparing token issue payload
  Nonce: 0, Checkpoint: 100

→ Issuing token...

→ Token issued
  Hash: 0x1234..., Token: 0x5678...

→ Validating transaction by hash...

→ Validating transaction receipt...

→ Waiting for finalization...

→ ✓ Token issued and finalized successfully
    ✔ should issue a new token successfully (5432ms)

...
```

## Step-by-Step Guide

### 1. Prepare Environment

Create a `.env.integration` file:

```bash
cp .env.integration.example .env.integration
```

Edit `.env.integration`:

```env
RUN_INTEGRATION_TESTS=true
INTEGRATION_TEST_NETWORK=local

# For local testing, use these default keys
INTEGRATION_TEST_OPERATOR_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
INTEGRATION_TEST_MASTER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

# Only needed for src/__integration__/nativeV2.test.ts
INTEGRATION_TEST_OPERATOR_ADDRESS=0x...address matching INTEGRATION_TEST_OPERATOR_KEY...
INTEGRATION_TEST_RECIPIENT=0x...recipient address...
INTEGRATION_TEST_TOKEN=0x...token address...
```

### 2. Fund Test Accounts (if needed)

For local networks, accounts are usually pre-funded. For testnets, you'll need to fund the operator and master accounts.

### 3. Run Tests

```bash
# Run all integration tests
npm run test:integration:local

# Or run specific test files
npx mocha --config .mocharc.integration.js src/__integration__/main-flow.test.ts
npx mocha --config .mocharc.integration.js src/__integration__/additional-flows.test.ts
```

## For Testnet

### 1. Get Testnet Keys

Generate or obtain private keys for testnet testing:

```bash
# You can use any Ethereum-compatible wallet
# Example using openssl:
openssl rand -hex 32
```

### 2. Fund Accounts

Get testnet tokens for your operator and master accounts.

### 3. Configure

```env
RUN_INTEGRATION_TESTS=true
INTEGRATION_TEST_NETWORK=testnet
INTEGRATION_TEST_OPERATOR_KEY=0x...your-operator-key...
INTEGRATION_TEST_MASTER_KEY=0x...your-master-key...
```

### 4. Run Tests

```bash
npm run test:integration:testnet
```

## Troubleshooting

### Tests are skipped

Make sure `RUN_INTEGRATION_TESTS=true` is set:

```bash
RUN_INTEGRATION_TESTS=true npm run test:integration:local
```

### Connection errors

1. Verify your network is running
2. Check the network configuration in `src/api/constants.ts`
3. For local networks, the default URL is usually `http://127.0.0.1:18555`

### Transaction failures

1. Ensure accounts have sufficient balance
2. Check that you're using the correct chain ID
3. Verify the private keys are correct and properly formatted

### Timeout errors

Integration tests have a 2-minute timeout by default. If your network is slow:

```bash
INTEGRATION_TEST_TIMEOUT=300000 npm run test:integration
```

## What Gets Tested

### Main Business Flow

1. ✓ Issue token
2. ✓ Grant mint authority
3. ✓ Mint tokens
4. ✓ Transfer tokens
5. ✓ Burn tokens
6. ✓ Bridge and mint
7. ✓ Burn and bridge
8. ✓ Revoke authority
9. ✓ Transaction validation (by hash, receipt, finalized)
10. ✓ Checkpoint APIs

### Additional Flows

1. ✓ Update token metadata
2. ✓ Pause and unpause token
3. ✓ Blacklist management
4. ✓ Whitelist management

### Native v2 Signing Flow

`nativeV2.test.ts` exercises the domain-separated v2 signing scheme
against a live node:

1. ✓ Health probe
2. ✓ Submit a v2 payment and confirm the node's returned hash
   matches the locally computed `transactionHash`

Before submitting, the test reads the node's `native_write_mode`
from `GET /api/status`. A `v1_only` node has not activated the v2
surface yet -- that is a valid deployment state, not a failure, so
the suite skips rather than fails. It also skips when integration
testing is disabled (`RUN_INTEGRATION_TESTS` unset).

This test needs three additional environment variables beyond the
ones above: `INTEGRATION_TEST_OPERATOR_ADDRESS` (the address for
`INTEGRATION_TEST_OPERATOR_KEY`), `INTEGRATION_TEST_RECIPIENT`, and
`INTEGRATION_TEST_TOKEN`. See `.env.integration.example`.

### Read-Endpoint API Tests

`accounts-api.test.ts`, `chain-api.test.ts`, `checkpoints-api.test.ts`,
`tokens-api.test.ts`, and `transactions-api.test.ts` exercise the read
endpoints of each `src/api/*` module against the live testnet
(`https://api.testnet.1money.network`). They used to live as unit
tests under `src/api/*/__test__/index.test.ts`, but since they launch
puppeteer and make real network calls, they were moved here so the
unit suite (`npm test`) stays deterministic and network-independent.

Each suite reads `src/__integration__/config.ts` in a `before` hook
and calls `this.skip()` when `RUN_INTEGRATION_TESTS` is not `'true'`,
the same pattern `nativeV2.test.ts` uses. Run them like any other
integration test:

```bash
npm run test:integration:testnet
# or target a single file:
npx cross-env RUN_INTEGRATION_TESTS=true INTEGRATION_TEST_NETWORK=testnet \
  mocha --config .mocharc.integration.js src/__integration__/accounts-api.test.ts
```

They additionally honor `RUN_ENV` (default `local`): when set to
`local` they also drive the same calls through a headless Chromium
page via puppeteer (set `CHROME_PATH` to point at a local Chrome/
Chromium binary if the bundled one isn't available), to catch
browser-bundle-specific issues; set `RUN_ENV=remote` to skip the
puppeteer path. A few of these tests were already `it.skip`-marked
before the move (e.g. write-path checkpoint/token/transaction flows)
and remain skipped -- that's pre-existing, not something the move
changed.

## Next Steps

- Read the full [Integration Tests README](./README.md)
- Check out the [SDK documentation](../../README.md)
- Explore the test code to understand usage patterns
