# Integration Tests

This directory contains integration tests for the 1Money Protocol TypeScript SDK. These tests interact with a real network (local, testnet, or mainnet) to validate the complete functionality of the SDK.

## Overview

The integration tests cover:

1. **Main Business Flow** (`main-flow.test.ts`)
   - Issue token
   - Grant authority
   - Mint token
   - Transfer token
   - Burn token
   - Bridge and mint
   - Burn and bridge
   - Revoke authority
   - Transaction validation (by hash, receipt, finalized)
   - Checkpoint APIs
   - Account APIs

2. **Additional Flows** (`additional-flows.test.ts`)
   - Update token metadata
   - Pause and unpause token
   - Manage blacklist
   - Manage whitelist

## Prerequisites

Before running integration tests, ensure you have:

1. A running 1Money network (local node, testnet, or mainnet access)
2. Test accounts with sufficient funds
3. Private keys for the operator and master accounts

## Configuration

### Environment Variables

Integration tests are configured via environment variables. You can set them in several ways:

1. **Command line** (recommended for CI/CD):
   ```bash
   RUN_INTEGRATION_TESTS=true npm run test:integration
   ```

2. **`.env.integration` file** (recommended for local development):
   ```bash
   cp .env.integration.example .env.integration
   # Edit .env.integration with your configuration
   ```

3. **Export in shell**:
   ```bash
   export RUN_INTEGRATION_TESTS=true
   export INTEGRATION_TEST_NETWORK=local
   npm run test:integration
   ```

### Available Environment Variables

| Variable | Description | Default | Options |
|----------|-------------|---------|---------|
| `RUN_INTEGRATION_TESTS` | Enable integration tests | `false` | `true`, `false` |
| `INTEGRATION_TEST_NETWORK` | Network to connect to | `local` | `local`, `testnet`, `mainnet` |
| `INTEGRATION_TEST_OPERATOR_KEY` | Operator private key | Local test key | Any valid private key |
| `INTEGRATION_TEST_MASTER_KEY` | Master account private key | Local test key | Any valid private key |
| `INTEGRATION_TEST_TIMEOUT` | Test timeout in ms | `120000` | Any number |

## Running Tests

### Quick Start

For local development with a local network:

```bash
# Run all integration tests on local network
npm run test:integration:local

# Run all integration tests on testnet
npm run test:integration:testnet

# Run with custom configuration
RUN_INTEGRATION_TESTS=true \
INTEGRATION_TEST_NETWORK=local \
INTEGRATION_TEST_OPERATOR_KEY=0x... \
INTEGRATION_TEST_MASTER_KEY=0x... \
npm run test:integration
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run test:integration` | Run integration tests (requires `RUN_INTEGRATION_TESTS=true`) |
| `npm run test:integration:local` | Run integration tests on local network |
| `npm run test:integration:testnet` | Run integration tests on testnet |
| `npm run test:all` | Run both unit tests and integration tests |

### Running Specific Tests

```bash
# Run only main flow tests
npx mocha --config .mocharc.integration.js src/__integration__/main-flow.test.ts

# Run only additional flow tests
npx mocha --config .mocharc.integration.js src/__integration__/additional-flows.test.ts
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  integration-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        env:
          RUN_INTEGRATION_TESTS: true
          INTEGRATION_TEST_NETWORK: testnet
          INTEGRATION_TEST_OPERATOR_KEY: ${{ secrets.OPERATOR_KEY }}
          INTEGRATION_TEST_MASTER_KEY: ${{ secrets.MASTER_KEY }}
        run: npm run test:integration
```

## Test Structure

### File Organization

```
src/__integration__/
├── README.md                    # This file
├── config.ts                    # Test configuration
├── setup.ts                     # Account setup and generation
├── helpers.ts                   # Utility functions
├── main-flow.test.ts           # Main business flow tests
└── additional-flows.test.ts    # Additional feature tests
```

### Test Accounts

The test suite automatically generates the following accounts:

- **Operator**: Signs transactions (from `INTEGRATION_TEST_OPERATOR_KEY`)
- **Master**: Token creator and authority manager (from `INTEGRATION_TEST_MASTER_KEY`)
- **User1**: Randomly generated, used for authority delegation
- **User2**: Randomly generated, used for token operations
- **User3**: Randomly generated, used for transfers and burns

## Best Practices

### 1. Conditional Execution

Integration tests only run when `RUN_INTEGRATION_TESTS=true`:

```typescript
(shouldRunIntegrationTests() ? describe : describe.skip)('Test Suite', function() {
  // Tests here
});
```

### 2. Proper Cleanup

Tests should clean up after themselves:

```typescript
after(function() {
  resetTestAccounts();
});
```

### 3. Timeouts

Integration tests have longer timeouts due to network interactions:

```typescript
this.timeout(getConfig().timeout); // Default: 120000ms (2 minutes)
```

### 4. Waiting for Finalization

Always wait for transactions to finalize before asserting results:

```typescript
const finalized = await waitForFinalization(txHash);
expect(finalized).to.be.true;
```

### 5. Network-Specific Configuration

Different networks may require different configurations:

```typescript
// For local network
INTEGRATION_TEST_NETWORK=local

// For testnet (may require real keys)
INTEGRATION_TEST_NETWORK=testnet
INTEGRATION_TEST_OPERATOR_KEY=0x...
INTEGRATION_TEST_MASTER_KEY=0x...
```

## Troubleshooting

### Tests are skipped

**Problem**: Integration tests are being skipped.

**Solution**: Ensure `RUN_INTEGRATION_TESTS=true` is set:
```bash
RUN_INTEGRATION_TESTS=true npm run test:integration
```

### Connection timeout

**Problem**: Tests fail with connection timeout.

**Solution**:
1. Ensure the network is running and accessible
2. Increase the timeout: `INTEGRATION_TEST_TIMEOUT=180000`
3. Check network configuration in `src/api/constants.ts`

### Transaction failures

**Problem**: Transactions fail with "insufficient funds" or similar errors.

**Solution**:
1. Ensure test accounts have sufficient balance
2. For local network, fund the accounts before running tests
3. Check that the operator and master keys are correct

### Signature errors

**Problem**: Transactions fail with signature errors.

**Solution**:
1. Verify that private keys are correctly formatted (must start with `0x`)
2. Ensure the correct network chain ID is being used
3. Check that the account addresses match the private keys

## Writing New Tests

To add new integration tests:

1. Create a new test file in `src/__integration__/`
2. Import necessary utilities from `config`, `setup`, and `helpers`
3. Wrap your test suite with conditional execution:

```typescript
import { expect } from 'chai';
import { shouldRunIntegrationTests, getConfig } from './config';
import { getTestAccounts } from './setup';
import { createTestClient, logSection, logStep } from './helpers';

(shouldRunIntegrationTests() ? describe : describe.skip)('My New Test', function() {
  this.timeout(getConfig().timeout);

  const client = createTestClient();
  const accounts = getTestAccounts();

  it('should do something', async function() {
    logSection('My Test Step');
    // Your test logic here
  });
});
```

## Contributing

When adding new features to the SDK, please also add corresponding integration tests to ensure the feature works correctly with the network.

## License

MIT
