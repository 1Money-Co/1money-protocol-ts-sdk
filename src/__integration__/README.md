# Integration tests

The integration suite talks to a running 1Money node. The required
state-changing gate is the local network:

```bash
npm run test:integration:local
```

The suite derives all account addresses from the configured private keys,
generates temporary user accounts, and creates its own public and private
token fixtures. No operator address, recipient address, or existing token
address is required.

## Configuration

Copy the environment template for local development:

```bash
cp .env.integration.example .env.integration
```

The supported settings are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUN_INTEGRATION_TESTS` | `false` | Enables network-dependent tests |
| `INTEGRATION_TEST_NETWORK` | `local` | `local`, `testnet`, or `mainnet` |
| `INTEGRATION_TEST_OPERATOR_KEY` | Local test key | Issues tokens and creates multisig accounts |
| `INTEGRATION_TEST_MASTER_KEY` | Local test key | Manages token authorities and policy |
| `INTEGRATION_TEST_TIMEOUT` | `120000` | Mocha timeout in milliseconds |

State-changing integration tests refuse to run against `mainnet`. Testnet
execution is explicit and requires funded operator and master credentials:

```bash
npm run test:integration:testnet
```

Never commit `.env.integration` or real private keys.

## Coverage

`v2-lifecycle.test.ts` is one sequential lifecycle covering every native v2
write operation:

- payment and batch payment;
- token issue, mint, authority, blacklist, whitelist, pause, burn, clawback,
  metadata update, bridge-and-mint, and burn-and-bridge;
- multisig account creation.

Each transaction follows the public prepare, sign, authorize, and submit
pipeline. The helper compares the locally computed transaction hash with the
hash returned by the node. The suite then polls for receipts and the relevant
chain state; it does not use fixed sleeps.

The remaining integration files exercise account, chain, checkpoint, token,
transaction, and status read surfaces. They run directly in Node.

## Commands

```bash
# Complete local gate
npm run test:integration:local

# Complete testnet gate with configured credentials
npm run test:integration:testnet

# One file only
npx mocha --config .mocharc.integration.js \
  src/__integration__/v2-lifecycle.test.ts

# One lifecycle step
npx mocha --config .mocharc.integration.js \
  src/__integration__/v2-lifecycle.test.ts \
  --grep "batch payment"
```

The integration glob lives in the npm scripts rather than the Mocha config,
so a positional file argument loads only that file.

When `RUN_INTEGRATION_TESTS` is not `true`, network suites skip. The lifecycle
also skips on a node reporting `native_write_mode: "v1_only"` because that
deployment has not activated the v2 write surface.

## Adding a transaction scenario

Use the shared context and v2 submission helper:

```typescript
const context = getIntegrationContext();
const prepared = TransactionBuilder.payment(input);
const { response } = await authorizeAndSubmitV2(
  prepared,
  signer,
  authorized =>
    context.client.transactions.payment(authorized)
);
const receipt = await waitForResult(() =>
  context.client.transactions.getReceiptByHash(
    response.hash
  )
);
expect(receipt.success).to.equal(true);
```

Read the sender nonce immediately before preparing each transaction and poll
the exact receipt or state transition the test needs.
