---
name: 1money-protocol-sdk
description: >-
  Use when writing or reviewing code that consumes the @1money/protocol-ts-sdk
  package to talk to the 1Money Network blockchain. Covers initializing the
  api() client, the .success()/.error()/.timeout()/.rest() promise-wrapper
  pattern, and the native v2 prepare → sign → authorize → submit flow for
  transactions (payments, batch payments, token issue/mint/burn, authority
  grants, blacklist/whitelist, pause, metadata, bridge, clawback, multisig
  account creation) via TransactionBuilder + createPrivateKeySigner. Also
  covers the legacy pre-3.0 signing scheme, now namespaced under
  LegacyV1TransactionBuilder and api().<module>.legacyV1.*. Trigger whenever
  the user mentions 1Money / 1money / "protocol-ts-sdk", or asks to
  issue/mint/burn/transfer a token, query a nonce/balance/checkpoint/chain id,
  estimate a fee, sign or submit a 1Money transaction, check native write
  status, or handle the SDK's promise/error pattern — even if they don't name
  the package. Do NOT use for generic EVM/ethers/viem work unrelated to
  1Money, or for the 1Money UI component / React hooks / Figma skills
  (different domains).
---

# Using the @1money/protocol-ts-sdk

This skill makes Claude correct and idiomatic when building apps on top of
`@1money/protocol-ts-sdk` — the TypeScript SDK for the **1Money Network**
blockchain. The SDK does three things, and almost every task is one of them:

1. **Read chain state** — query nonces, balances, token metadata, checkpoints,
   chain id, transactions, fee estimates, native write status. (`api()`
   client, GET methods.)
2. **Write transactions** — build an unsigned tx, sign its digest, authorize
   it into a request, submit it. This is a strict pipeline; getting the steps
   or their order wrong is the most common failure.
3. **Use helper utilities** — derive token-account / multisig addresses, hash,
   hex-encode.

When the user's task is non-trivial (multi-step flows, signing, error handling,
choosing the right endpoint), **read the relevant reference file** rather than
guessing signatures — the SDK has specific shapes that are easy to get subtly
wrong.

| You need… | Read |
| --- | --- |
| Every read endpoint, its args, and response shape | `references/api-reference.md` |
| Building + signing + submitting any transaction type (v2 and legacy v1) | `references/transactions.md` |
| Promise wrapper, error handling, v2 error codes, config, networks, utils | `references/client-and-errors.md` |

## Install

```shell
npm i -S @1money/protocol-ts-sdk axios viem @ethereumjs/rlp
```

`axios`, `viem`, and `@ethereumjs/rlp` are **peer dependencies** — the consuming
app must install them too, or imports fail at runtime. Keep them within the
ranges in the package's `peerDependencies` (axios ≥1.15 <2, viem ≥2 <3,
@ethereumjs/rlp ≥10 <11).

## Where to import from (this trips people up)

The package root re-exports: the `api` function, the **signing** layer
(`TransactionBuilder`, `LegacyV1TransactionBuilder`, `createPrivateKeySigner`,
`deriveMultisigAddress`, `calculateBatchPaymentOperationsHash`, the EIP-712
typed-data helpers, signer/types), the
**utils** (`deriveTokenAddress`, `calcTxHash`, `toHex`, `validateMemo`, …), and
`client`.

Enums (`AuthorityType`, `AuthorityAction`, `ManageListAction`, `PauseAction`)
and request/response **types** live under the `/api` subpath, **not** the root.
Enums are runtime *values* (not erasable types), so a root import resolves to
`undefined` (`AuthorityType.MasterMint` throws) or fails to compile. Always
import enums from `/api`:

```typescript
import { api, TransactionBuilder, calculateBatchPaymentOperationsHash, createPrivateKeySigner } from '@1money/protocol-ts-sdk';
import { AuthorityType, ManageListAction } from '@1money/protocol-ts-sdk/api';
```

The only public subpaths are `.`, `/api`, `/client`, and `/utils`. `CHAIN_IDS`
is **not** re-exported from any of them, so don't import it — get the chain id at
runtime with `client.chain.getChainId()`.

## Initialize the client

```typescript
import { api } from '@1money/protocol-ts-sdk';

const client = api();                                  // mainnet (default)
const testnet = api({ network: 'testnet' });           // 'mainnet' | 'testnet' | 'local'
const slow = api({ network: 'testnet', timeout: 5000 }); // ms, default 10000
```

`client` exposes six modules: `accounts`, `checkpoints`, `tokens`,
`transactions`, `chain`, `status`. `status` is new in 3.0 — see
`getNativeWriteStatus` / `getHealth` in `references/api-reference.md`.

> **Singleton gotcha:** `api()` configures one shared underlying HTTP client via
> global config (base URL, timeout). It does **not** create isolated instances —
> the most recent `api(...)` call wins for *all* references. Don't expect a
> mainnet client and a testnet client to coexist in the same process; pick one
> network per process, or re-call `api({network})` before a batch of calls.

## The promise-wrapper pattern (read this before any call)

**Reads return the chainable wrapper; native v2 writes return a plain
`Promise`.** Every read method (all `get*`/`estimateFee` calls) and every
`legacyV1.*` write returns a thenable with handler methods — chain handlers or
`await` directly, your choice. The native v2 write methods (`payment`,
`batchPayment`, `issueToken`, `mintToken`, `burnToken`, `clawbackToken`,
`grantAuthority`, `manageBlacklist`, `manageWhitelist`, `pauseToken`,
`updateMetadata`, `bridgeAndMint`, `burnAndBridge`, `createMultisig` — anything
taking an `AuthorizedTxV2`) are plain `async` functions under the hood
(`submitAuthorized` in `src/api/submit.ts`), so they return a native `Promise`
with no `.success()`/`.error()`/`.timeout()`/`.rest()` — `await` them in a
`try/catch` (see the submit step in the next section).

```typescript
// Chain style — handlers transform the result; errors are HANDLED, not thrown.
client.checkpoints.getNumber()
  .success(res => console.log(res.number))
  .error(err => console.error(err));

// Await style — resolves with the response body on success, THROWS on error.
try {
  const res = await client.checkpoints.getNumber();
  console.log(res.number);
} catch (err) {
  console.error(err); // ParsedError: { name, message, status, data, stack }
}
```

Key facts that prevent bugs:

- The value passed to `.success(cb)` is the **decoded response body directly**
  (e.g. `{ nonce }`, `{ chain_id }`) — there is no `.data` wrapper to unwrap.
- Available handlers: `.success`, `.failure`, `.error`, `.timeout`, `.login`,
  and `.rest` (a catch-all for the cases you didn't handle). `.timeout` fires
  specifically on the configured timeout.
- If you attach `.error()`/`.rest()`, awaiting the chain **resolves** with the
  handler's return value instead of throwing. If you attach no error handler and
  `await`, errors **throw**. Pick one model per call site; don't half-mix them.

Full semantics, the `.rest(cb, scope)` form, and the v2 error codes are in
`references/client-and-errors.md`.

## Writing a transaction: prepare → sign → authorize → submit

Every state-changing operation is a domain-separated **native v2** write by
default. Never hand-roll RLP encoding, hashing, or signatures —
`TransactionBuilder` does it correctly.

```typescript
import { api, TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });
const sender = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`; // never hardcode

// 1. Fetch the two fields every tx needs: chain_id and the sender's nonce.
const { chain_id } = await client.chain.getChainId();
const { nonce } = await client.accounts.getNonce(sender);

// 2. PREPARE the unsigned operation (validates inputs, computes the digest
//    to sign). memo is always accepted and always sent on the wire — pass
//    {} or omit the option entirely for "no business memo" (three empty
//    strings), which is a different encoded value from a memo being absent.
const prepared = TransactionBuilder.payment(
  {
    chain_id,
    nonce,
    recipient: '0xa128999Be299373D7881f4aDD11510030ad13512',
    value: '1000000000',           // ALWAYS a string in the token's base units
    token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  },
  { memo: { type: 'invoice', format: 'text', data: 'order-12345' } }
);

// 3. SIGN the digest, AUTHORIZE it into a plain-JSON request, then SUBMIT.
const signature = await createPrivateKeySigner(privateKey).signDigest(
  prepared.signingHash
);
const authorized = prepared.authorize(signature); // v must be 0 or 1
const { hash } = await client.transactions.payment(authorized);

console.log('tx hash:', hash);
```

`authorized` (an `AuthorizedTxV2`) is plain JSON — no methods, no `Uint8Array` —
so it can cross a process boundary (sign on one machine, submit from another).

The builder you call and the endpoint you submit to must match. Quick map (all
fourteen native v2 operations):

| `TransactionBuilder.…` | Submit with `client.…` | `pathV2` |
| --- | --- | --- |
| `payment` | `transactions.payment` | `/v2/transactions/payment` |
| `batchPayment` | `transactions.batchPayment` | `/v2/transactions/batch_payment` |
| `tokenIssue` | `tokens.issueToken` | `/v2/tokens/issue` |
| `tokenMint` | `tokens.mintToken` | `/v2/tokens/mint` |
| `tokenBurn` | `tokens.burnToken` | `/v2/tokens/burn` |
| `tokenAuthority` | `tokens.grantAuthority` | `/v2/tokens/grant_authority` |
| `tokenBlacklist` | `tokens.manageBlacklist` | `/v2/tokens/manage_blacklist` |
| `tokenWhitelist` | `tokens.manageWhitelist` | `/v2/tokens/manage_whitelist` |
| `tokenPause` | `tokens.pauseToken` | `/v2/tokens/pause` |
| `tokenMetadata` | `tokens.updateMetadata` | `/v2/tokens/update_metadata` |
| `tokenBridgeAndMint` | `tokens.bridgeAndMint` | `/v2/tokens/bridge_and_mint` |
| `tokenBurnAndBridge` | `tokens.burnAndBridge` | `/v2/tokens/burn_and_bridge` |
| `tokenClawback` | `tokens.clawbackToken` | `/v2/tokens/clawback` |
| `createMultisig` | `accounts.createMultisig` | `/v2/accounts/multisig` |

`tokenManageList` no longer exists — it split into `tokenBlacklist` and
`tokenWhitelist`, which are distinct operations with distinct signing hashes
(they are no longer "build once, submit to either endpoint"). `batchPayment`
and `createMultisig` are v2-only: there is no legacy form of either, and
`accounts` has no `legacyV1` namespace at all.

Exact parameter fields for each builder, the enum values they need, the memo
rule in full, `deriveMultisigAddress` for computing a multisig account address
before submission, a custom-signer pattern (wallets/HSM), the alternate
**EIP-712 typed-data payment** path, verifying the result, and the legacy v1
scheme (`LegacyV1TransactionBuilder` + `api().<module>.legacyV1.*`) are in
`references/transactions.md`.

## Import map (v2 default + legacy v1)

```typescript
import {
  api,
  TransactionBuilder,          // = native v2 builder (default since 3.0)
  LegacyV1TransactionBuilder,  // pre-3.0 scheme, explicit opt-in
  createPrivateKeySigner,      // shared by both: signs a digest
  deriveMultisigAddress,       // pure, offline multisig address derivation
  calculateBatchPaymentOperationsHash, // BatchPayment operations oracle
} from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });
client.transactions.payment(authorizedTxV2);          // v2 write
client.transactions.legacyV1.payment(legacyPayload);   // legacy v1 write
client.tokens.manageBlacklist(authorizedTxV2);         // v2 write
client.tokens.legacyV1.manageBlacklist(legacyPayload);  // legacy v1 write
client.accounts.createMultisig(authorizedTxV2);        // v2-only, no legacyV1
client.status.getNativeWriteStatus();                  // GET /api/status
```

## Non-negotiable conventions

These reflect what the SDK actually validates and how the chain expects data —
violating them throws or silently produces a bad transaction.

- **Amounts are decimal strings in base units**, never JS numbers and never
  decimals. 1 token with 18 decimals = `'1000000000000000000'`. The builders
  validate `value` matches `/^\d+$/`.
- **Addresses must be valid + EIP-55**. Builders validate with viem's
  `isAddress`; a wrongly-checksummed mixed-case address is rejected.
- **`chain_id` and `nonce` are integers** you fetch fresh per transaction
  (`chain.getChainId`, `accounts.getNonce`). Reusing a stale nonce fails; for
  several txs from one sender, increment locally or re-fetch between them.
- **Never hardcode or commit a private key.** Load from env/secret store. Prefer
  `createPrivateKeySigner`, or a custom signer when the key lives in a
  wallet/HSM.
- **`memo` is always sent on the v2 surface.** Passing no `memo` option still
  sends `{ type: '', format: '', data: '' }` on the wire — that is a specific
  encoded value, not an omitted field, and it has its own signing hash.
  Details in `references/transactions.md`.
- **Signature `v` must be `0` or `1`** on the v2 surface. A legacy `27`/`28` is
  **rejected**, not converted — you signed the wrong digest if you see this.
- **`AuthorizedTxV2` is plain JSON.** Safe to `JSON.stringify`/parse across a
  process boundary for offline signing.
- **Prefer `TransactionBuilder` over `LegacyV1TransactionBuilder`.** The legacy
  builder targets the `/v1` write surface, which a node rejects with 410 once
  its `NativeWriteMode` reaches `'v2_only'` (the runtime value is the
  lowercase string, not `V2Only`). Use it only as an explicit, deliberate
  opt-in during a migration window — never as a fallback triggered by
  retrying a failed v2 submission (see `TransactionHashMismatchError` in
  `client-and-errors.md`).
- **Prefer `TransactionBuilder`/`LegacyV1TransactionBuilder` over
  `signMessage`/`encodePayload`.** The latter are `@deprecated` legacy helpers.
