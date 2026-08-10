# Integration tests quick start

## Local node

1. Start a local 1Money node at the SDK's configured local endpoint.
2. Create the local environment file:

   ```bash
   cp .env.integration.example .env.integration
   ```

3. Run the complete gate:

   ```bash
   npm run test:integration:local
   ```

The default local operator and master keys are already in the example file.
The suite derives their addresses, generates temporary users, and issues the
token fixtures it needs.

### Batch Payment

Enable Batch Payment in the local l1client governance configuration before
running this suite. The node must expose
`/v1/transactions/batch_payment/estimate_fee`; the lifecycle treats a disabled
or unavailable estimate endpoint as a configuration failure rather than a
skip. Its sender must have enough token balance for all batch operations and
the actual charged fee.

The estimate is an unsigned, point-in-time quote and is intentionally not
compared to `receipt.fee_used`. Batch receipt `success_info.receiver` is the
zero-address sentinel, so use the ordered `PaymentExecuted` execution events
to identify the recipients.

## Testnet

Set funded testnet keys in `.env.integration`, then run:

```env
RUN_INTEGRATION_TESTS=true
INTEGRATION_TEST_NETWORK=testnet
INTEGRATION_TEST_OPERATOR_KEY=0x...
INTEGRATION_TEST_MASTER_KEY=0x...
```

```bash
npm run test:integration:testnet
```

The state-changing suite rejects `mainnet`.

## Target one suite

```bash
npx mocha --config .mocharc.integration.js \
  src/__integration__/v2-lifecycle.test.ts

npx mocha --config .mocharc.integration.js \
  src/__integration__/accounts-api.test.ts
```

Positional file selection is deterministic: Mocha does not append a hidden
integration glob from its config.

## What the lifecycle verifies

The lifecycle submits all fourteen native v2 operations through the public
SDK API. Every write:

1. fetches a current nonce;
2. prepares a `TransactionBuilder` v2 payload;
3. signs `prepared.signingHash`;
4. authorizes and submits to the matching `/v2` method;
5. compares the local and server transaction hashes;
6. polls for a successful receipt and validates chain state.

Temporary 404 responses while a receipt is being indexed are expected and
are retried by the polling helper.

If tests skip, confirm `RUN_INTEGRATION_TESTS=true`. If they time out, verify
the node endpoint and increase `INTEGRATION_TEST_TIMEOUT`.
