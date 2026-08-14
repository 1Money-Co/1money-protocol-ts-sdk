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

#### Why there is no partially-applied batch to test

A rejected batch is refused whole at submit time, and the suite asserts
exactly that. A batch that is *admitted and then fails midway* — leaving some
operations applied — is not reachable through the public API, so no test
targets it. Three independent reasons, verified against l1client:

1. The node validates at admission with `ValidationRule::full()`
   (`om-verifier/src/transaction_verifier.rs`) but executes with
   `new_without_token_authority_validation()` (`om-execution/src/lib.rs`),
   which is Balance/Nonce/Fee only. Despite its name it drops the authority,
   blacklist *and* whitelist checks, so the execution rule set is a strict
   subset of the admission one: no check can fire at execution that did not
   already fire at admission.
2. `execute_batch_payment` accumulates every mutation in `PendingBalances`
   and materialises it only at the closing `into_changeset()`. Any earlier
   `?` discards the whole batch, so partial application cannot occur.
3. `BatchFailureInfo` / `failed_operation_index` are defined in
   `om-primitives-types/src/core/receipt.rs` and constructed nowhere — the
   node has no code path that reports a partially-failed batch.

The only residual route is a Balance/Nonce/Fee race between admission and
execution, which is non-deterministic by nature and cannot be a repeatable
test. Do not add a probe for it; extend the refusal test instead.

## Testnet

There is no dedicated testnet script — running this suite against a shared
public network is a deliberate act, not a one-word command. Put funded
testnet credentials in `.env.integration`:

```env
RUN_INTEGRATION_TESTS=true
INTEGRATION_TEST_NETWORK=testnet
INTEGRATION_TEST_OPERATOR_KEY=0x...
INTEGRATION_TEST_MASTER_KEY=0x...
```

then run the network-agnostic script, which picks the network up from that
file:

```bash
npm run test:integration
```

Know what this costs before you do. One run submits **36 write
transactions**, including three token issuances, and every one of them is
permanent on a shared chain — unlike the local node, which is disposable.
The operator and master keys must actually hold their protocol roles on
that network, or token issuance fails with a permission error. Batch
payment must be enabled there by governance, or the suite raises a
configuration error rather than skipping.

Also note the polling budget is tuned for the local node: a receipt gets
`500ms + 29 x 250ms`, about 7.75s. Local receipts land in 250-500ms, so
that is ample there; a slower public network may need `attempts` or
`intervalMs` raised in `RECEIPT_POLL`.

The state-changing suite rejects `mainnet` outright.

## Target one suite

```bash
npx mocha --config .mocharc.integration.js \
  src/__integration__/v2-lifecycle.test.ts

npx mocha --config .mocharc.integration.js \
  src/__integration__/accounts-api.test.ts
```

Positional file selection is deterministic: Mocha does not append a hidden
integration glob from its config.

## Watching a run

By default the suite prints nothing about where it is pointed. Set
`INTEGRATION_TEST_VERBOSE=true` to see it:

```bash
pnpm test:integration:local:verbose
# or on any invocation:
INTEGRATION_TEST_VERBOSE=true pnpm test:integration:local
```

With it unset, output is byte-for-byte what it was before, so CI is
unaffected. With it set, you get the target, the accounts, and every HTTP
exchange in full:

```
[1Money SDK integration] === Integration target ===
[1Money SDK integration] network:  local
[1Money SDK integration] base URL: http://localhost:18555
[1Money SDK integration] timeout:  120000ms
[1Money SDK integration] ==========================
[1Money SDK integration] --- accounts generated ---
[1Money SDK integration] operator     0x04c6C468f33af589863E6C0fC190cfEEFDda9e97
[1Money SDK integration] master       0x70997970C51812dc3A010C7d01b50e0d17dc79C8
...
[1Money SDK integration] -> #8 POST http://localhost:18555/v2/tokens/issue
[1Money SDK integration]    #8 request  {"chain_id":1212101,"nonce":28,"symbol":"V20VNC",…}
[1Money SDK integration] <- #8 200 14ms
[1Money SDK integration]    #8 response {"hash":"0xb9a8…","token":"0x33e3…"}
[1Money SDK integration] -> #9 GET http://localhost:18555/v1/transactions/receipt/by_hash?hash=0xb9a8…
[1Money SDK integration] <- #9 404 1ms
[1Money SDK integration]    #9 response {"error_code":"resource_transaction_not_found",…}
```

Details worth knowing:

- **`#N` pairs a response with its request.** The suite issues concurrent
  reads via `Promise.all`, so the lines interleave; the id and the elapsed
  time are the only way to pair and time them.
- **Failures are logged too, then rethrown untouched.** The 404s above are
  the polling helper waiting for a receipt to be indexed, which is normal.
  The interceptor is an observer — it never swallows a rejection.
- **The base URL is read back from the axios defaults that `api()` set**,
  not re-derived from the network name, so it is the URL actually in use
  rather than a second copy of the mapping that could drift.
- **The banner prints once per process; the account block prints once per
  generation.** `__test__/context.test.ts` resets the context and the
  accounts to exercise config parsing, so two throwaway sets exist before
  the real one. Printing at generation keeps each line true — the **last**
  block is the set the lifecycle signs with.
- **Retried polls are not collapsed.** Repeated identical request lines are
  how a slow or stuck read becomes visible.
- **Bodies are printed whole**, with a 4000-character valve so one
  pathological response cannot bury the run. Nothing in this suite comes
  close to that; a truncated line is marked `... (N chars total)`.
- Request bodies carry signatures (`r`/`s`/`v`) and public keys, which are
  public data. Private keys never cross the wire, so they never appear
  here.

## What the lifecycle verifies

The lifecycle submits all fourteen native v2 operations through the public
SDK API. Every write:

1. fetches a current nonce;
2. prepares a `TransactionBuilder` v2 payload;
3. signs `prepared.signingHash`;
4. authorizes and submits to the matching `/v2` method;
5. compares the local and server transaction hashes;
6. polls for a successful receipt and validates chain state.

Waiting is split into two profiles, because the two things being waited on
behave differently:

- `RECEIPT_POLL` — reading the receipt for a transaction just submitted.
  `waitForResult` holds its **first** look for 500ms via `initialDelayMs`.
  A receipt only becomes readable 250–500ms after submission, so reading
  at t=0 is a guaranteed miss: before this, every one of the 33 receipt
  lookups in a run needed exactly two 404s first (96 of 129 receipt
  reads). The wall clock is unchanged — the same ~500ms elapses either
  way, sleeping instead of issuing reads that cannot succeed.
- `STATE_POLL` — reading balances, token metadata or nonces after that
  receipt is already confirmed. These never miss (token_account 29 reads,
  token_metadata 20, nonce 36, all first-attempt hits), so they get no
  initial delay. Applying one uniformly to all 59 call sites added 16s of
  pure sleep to the suite.

The 404s that remain in a verbose run are the batch-refusal test's
confirmation window (30 receipt + 30 finalized reads), where `not_found`
is the assertion rather than a transient state.

Two dimensions are covered by dedicated cases rather than by the fourteen
operation walks, because the walk itself only reaches one side of each:

- **Authority revocation.** The walk grants three times and never revokes,
  so `revokes bridge authority through v2` runs after the last bridge
  operation and asserts the address leaves `bridge_mint_authorities`.
- **Populated memos.** Every v2 operation signs `rlp([payload_fields,
  memo])`, but the walk signs the canonical empty memo everywhere except
  the batch payment. Three cases at the end of the file round-trip a memo
  through `getByHash` and compare it field-by-field: one at the exact
  128/64/256-byte limits (every field past the 55-byte RLP long-form
  boundary, which no other memo in the suite crosses), one carrying
  multi-byte UTF-8, and one on a non-payment operation. The node
  re-derives the signing hash from the memo bytes it received, so a memo
  encoded differently from the node's fails signature verification rather
  than round-tripping.

If tests skip, confirm `RUN_INTEGRATION_TESTS=true`. If they time out, verify
the node endpoint and increase `INTEGRATION_TEST_TIMEOUT`.
