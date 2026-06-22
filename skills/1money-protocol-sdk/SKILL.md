---
name: 1money-protocol-sdk
description: >-
  Use when writing or reviewing code that consumes the @1money/protocol-ts-sdk
  package to talk to the 1Money Network blockchain. Covers initializing the
  api() client, the .success()/.error()/.timeout()/.rest() promise-wrapper
  pattern, and the build → sign → submit flow for transactions (payments, token
  issue/mint/burn, authority grants, blacklist/whitelist, pause, metadata,
  bridge, clawback) via TransactionBuilder + createPrivateKeySigner. Trigger
  whenever the user mentions 1Money / 1money / "protocol-ts-sdk", or asks to
  issue/mint/burn/transfer a token, query a nonce/balance/checkpoint/chain id,
  estimate a fee, sign or submit a 1Money transaction, or handle the SDK's
  promise/error pattern — even if they don't name the package. Do NOT use for
  generic EVM/ethers/viem work unrelated to 1Money, or for the 1Money UI
  component / React hooks / Figma skills (different domains).
---

# Using the @1money/protocol-ts-sdk

This skill makes Claude correct and idiomatic when building apps on top of
`@1money/protocol-ts-sdk` — the TypeScript SDK for the **1Money Network**
blockchain. The SDK does three things, and almost every task is one of them:

1. **Read chain state** — query nonces, balances, token metadata, checkpoints,
   chain id, transactions, fee estimates. (`api()` client, GET methods.)
2. **Write transactions** — build an unsigned tx, sign it, submit it. This is a
   strict three-step pipeline; getting the steps or their order wrong is the
   most common failure.
3. **Use helper utilities** — derive token-account addresses, hash, hex-encode.

When the user's task is non-trivial (multi-step flows, signing, error handling,
choosing the right endpoint), **read the relevant reference file** rather than
guessing signatures — the SDK has specific shapes that are easy to get subtly
wrong.

| You need… | Read |
| --- | --- |
| Every read endpoint, its args, and response shape | `references/api-reference.md` |
| Building + signing + submitting any transaction type | `references/transactions.md` |
| Promise wrapper, error handling, config, networks, utils | `references/client-and-errors.md` |

## Install

```shell
npm i -S @1money/protocol-ts-sdk axios viem @ethereumjs/rlp
```

`axios`, `viem`, and `@ethereumjs/rlp` are **peer dependencies** — the consuming
app must install them too, or imports fail at runtime. Keep them within the
ranges in the package's `peerDependencies` (axios ≥1.15 <2, viem ≥2 <3,
@ethereumjs/rlp ≥10 <11).

## Where to import from (this trips people up)

The package root re-exports only: the `api` function, the **signing** layer
(`TransactionBuilder`, `createPrivateKeySigner`, signer/types), the **utils**
(`deriveTokenAddress`, `calcTxHash`, `toHex`, …), and `client`.

Enums (`AuthorityType`, `AuthorityAction`, `ManageListAction`, `PauseAction`)
and request/response **types** live under the `/api` subpath, **not** the root.
The README imports some enums from the root — that's a bug: the root never
re-exports them, and because enums are runtime *values* (not erasable types) a
root import resolves to `undefined` (so `AuthorityType.MasterMint` throws) or
fails to compile. Always import enums from `/api`:

```typescript
import { api, TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';
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

`client` exposes five modules: `accounts`, `checkpoints`, `tokens`,
`transactions`, `chain`.

> **Singleton gotcha:** `api()` configures one shared underlying HTTP client via
> global config (base URL, timeout). It does **not** create isolated instances —
> the most recent `api(...)` call wins for *all* references. Don't expect a
> mainnet client and a testnet client to coexist in the same process; pick one
> network per process, or re-call `api({network})` before a batch of calls.

## The promise-wrapper pattern (read this before any call)

Every API method returns a thenable with handler methods. **You can either chain
handlers or `await` directly — but be deliberate about which.**

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

Full semantics and the `.rest(cb, scope)` form are in
`references/client-and-errors.md`.

## Writing a transaction: build → sign → submit

Every state-changing operation follows the **same three steps**. Never hand-roll
RLP encoding, hashing, or signatures — `TransactionBuilder` does it correctly
(including low-S enforcement to avoid malleability).

```typescript
import { api, TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });
const sender = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`; // never hardcode

// 1. Fetch the two fields every tx needs: chain_id and the sender's nonce.
//    Awaiting directly returns the response body (and throws on error).
const { chain_id } = await client.chain.getChainId();
const { nonce } = await client.accounts.getNonce(sender);

// 2. BUILD the unsigned transaction (validates inputs, prepares the digest).
const prepared = TransactionBuilder.payment({
  chain_id,
  nonce,
  recipient: '0xa128999Be299373D7881f4aDD11510030ad13512',
  value: '1000000000',           // ALWAYS a string in the token's base units
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
});

// 3. SIGN, then build the request body, then SUBMIT to the matching endpoint.
const signed = await prepared.sign(createPrivateKeySigner(privateKey));
const { hash } = await client.transactions.payment(signed.toRequest()); // throws on error

console.log('tx hash:', hash);
```

The builder you call and the endpoint you submit to must match. Quick map:

| `TransactionBuilder.…` | Submit with `client.…` | Returns |
| --- | --- | --- |
| `payment` | `transactions.payment` | `{ hash }` |
| `tokenIssue` | `tokens.issueToken` | `{ hash, token }` |
| `tokenMint` | `tokens.mintToken` | `{ hash }` |
| `tokenBurn` | `tokens.burnToken` | `{ hash }` |
| `tokenAuthority` | `tokens.grantAuthority` | `{ hash }` |
| `tokenManageList` | `tokens.manageBlacklist` / `tokens.manageWhitelist` | `{ hash }` |
| `tokenPause` | `tokens.pauseToken` | `{ hash }` |
| `tokenMetadata` | `tokens.updateMetadata` | `{ hash }` |
| `tokenBridgeAndMint` | `tokens.bridgeAndMint` | `{ hash }` |
| `tokenBurnAndBridge` | `tokens.burnAndBridge` | `{ hash }` |
| `tokenClawback` | `tokens.clawbackToken` | `{ hash }` |

Exact parameter fields for each builder, the enum values they need, the optional
`memo` field (and how it switches a tx to the V2 envelope), a custom-signer
pattern (wallets/HSM, when you can't hold the raw key), the alternate **EIP-712
typed-data payment** path (`preparePaymentTypedTx`, for `eth_signTypedData_v4`
wallets), and verifying the result are in `references/transactions.md`.

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
  `createPrivateKeySigner`, or a custom `SignerAdapter` when the key lives in a
  wallet/HSM.
- **Prefer `TransactionBuilder` over `signMessage`/`encodePayload`.** The latter
  are `@deprecated` legacy helpers; the builder flow is the supported path.
- **`memo` is optional but not cosmetic.** Every builder accepts `memo?: Memo`
  (`{ type?, format?, data? }`). Passing *any* memo — even `{}` — switches the tx
  to the V2 envelope and changes its signature/tx hash vs. the no-memo V1 form.
  Omit it unless you actually want a memo. Details in `references/transactions.md`.
