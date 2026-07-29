# Building, signing & submitting transactions

Since **3.0**, `TransactionBuilder` means the **native v2** domain-separated
scheme. It targets the node's `/v2` write surface, always sends a memo object
on the wire for every memo-capable operation (see below) — supplying one is
optional for the caller, but the field itself is never absent from the
request — and produces a plain-JSON authorized request instead of a mutable
"signed tx" object. The pre-3.0 scheme still exists, namespaced under
`LegacyV1TransactionBuilder` — see [Legacy v1](#legacy-v1) at the end of this
file.

## The v2 pipeline

```typescript
import { api, TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });

// 1. Inputs every tx needs. Awaiting directly returns the body; it throws on
//    error (or attach .success/.error handlers — see client-and-errors.md).
const { chain_id } = await client.chain.getChainId();
const { nonce } = await client.accounts.getNonce(sender);

// 2. PREPARE (validates fields, RLP-encodes the domain-separated payload,
//    computes the digest to sign). `memo` is an option, not a payload field —
//    the unsigned payload object itself must NOT carry a `memo` property
//    (a leftover from migrating a v1-shaped payload); `prepare` throws if it
//    does, rather than silently overwriting it with the empty memo.
const prepared = TransactionBuilder.<op>(
  { chain_id, nonce, /* ...fields */ },
  { memo }, // optional at the call site; always sent on the wire (see Memo below)
);

// 3. SIGN the digest with any SignerAdapter.
const signature = await createPrivateKeySigner(privateKey).signDigest(
  prepared.signingHash
);

// 4. AUTHORIZE — turns the signature into a plain-JSON request. Throws for a
//    bad `v`, and also enforces the same low-S (non-malleable) check the
//    legacy path always ran — a high-S signature is rejected here, locally,
//    instead of producing a confidently-computed hash for a transaction the
//    node will reject at admission.
const authorized = prepared.authorize(signature);

// 5. SUBMIT to the matching endpoint. Throws one of three distinct errors —
//    see client-and-errors.md for the full contract and which are safe to
//    retry:
//      - TransactionHashMismatchError   (submitted: true      -- do NOT retry)
//      - TransactionSubmissionError     (submitted: false     -- safe to retry)
//      - TransactionOutcomeUnknownError (submitted: 'unknown' -- query the
//        hash first; 'unknown' is truthy on purpose, so `if (!err.submitted)`
//        does not mistake this for "safe to retry")
//    Also throws synchronously (before any network call) if `authorized`
//    came from a different builder than the method you called it with, e.g.
//    passing a `tokenBurn` authorization to `client.transactions.payment`.
const res = await client.<module>.<method>(authorized);
```

`const { hash } = await prepared.authorize(sig)` is wrong: `authorize` is
synchronous and returns the request object directly, not a promise.

## What the objects give you

`TransactionBuilder.<op>(unsigned, options?)` returns a **`PreparedTxV2`**:

```typescript
interface PreparedTxV2<TUnsigned> {
  operation: OperationName;      // e.g. 'payment', 'tokenBlacklist'
  unsigned: TUnsigned;
  signingHash: `0x${string}`;    // the 32-byte digest a signer must sign
  authorize: (signature: Signature) => AuthorizedTxV2;
}
```

`prepared.authorize(signature)` returns an **`AuthorizedTxV2`** — plain data,
no methods, so it survives `JSON.stringify` across a process boundary (sign on
one machine, submit from another):

```typescript
interface AuthorizedTxV2 {
  operation: OperationName;
  path: string;                  // the pathV2 this must be POSTed to
  request: Record<string, unknown>; // the JSON body to send
  transactionHash: `0x${string}`;   // the tx hash the node should echo back
}
```

`createPrivateKeySigner(privateKey: \`0x${string}\`)` produces a
`SignerAdapter` (`{ signDigest(digest) => Promise<Signature> }`) that signs
with low-S. The same adapter works for both the v2 and legacy v1 flows — it
only ever signs a 32-byte digest, and doesn't know which scheme produced it.

## Builder ↔ endpoint map (all fourteen v2 operations)

| `TransactionBuilder.…` | Submit `client.…` | `pathV2` | Returns |
| --- | --- | --- | --- |
| `payment` | `transactions.payment` | `/v2/transactions/payment` | `{ hash }` |
| `batchPayment` | `transactions.batchPayment` | `/v2/transactions/batch_payment` | `{ hash }` |
| `tokenIssue` | `tokens.issueToken` | `/v2/tokens/issue` | `{ hash, token }` |
| `tokenMint` | `tokens.mintToken` | `/v2/tokens/mint` | `{ hash }` |
| `tokenBurn` | `tokens.burnToken` | `/v2/tokens/burn` | `{ hash }` |
| `tokenAuthority` | `tokens.grantAuthority` | `/v2/tokens/grant_authority` | `{ hash }` |
| `tokenBlacklist` | `tokens.manageBlacklist` | `/v2/tokens/manage_blacklist` | `{ hash }` |
| `tokenWhitelist` | `tokens.manageWhitelist` | `/v2/tokens/manage_whitelist` | `{ hash }` |
| `tokenPause` | `tokens.pauseToken` | `/v2/tokens/pause` | `{ hash }` |
| `tokenMetadata` | `tokens.updateMetadata` | `/v2/tokens/update_metadata` | `{ hash }` |
| `tokenBridgeAndMint` | `tokens.bridgeAndMint` | `/v2/tokens/bridge_and_mint` | `{ hash }` |
| `tokenBurnAndBridge` | `tokens.burnAndBridge` | `/v2/tokens/burn_and_bridge` | `{ hash }` |
| `tokenClawback` | `tokens.clawbackToken` | `/v2/tokens/clawback` | `{ hash }` |
| `createMultisig` | `accounts.createMultisig` | `/v2/accounts/multisig` | `{ hash }` |

Two operations are **v2-only** — there is no legacy form:

- `createMultisig` — legacy clients used `POST /v1/transactions/raw`, which is
  retired and returns 410. `accounts` has no `legacyV1` namespace at all.
- `batchPayment` — `transactions.legacyV1` exposes only `payment`; there is no
  `transactions.legacyV1.batchPayment`.

`tokenManageList` from pre-3.0 SDKs **no longer exists**. It split into
`tokenBlacklist` and `tokenWhitelist` — these are distinct v2 operations with
distinct `operationType` values and distinct signing hashes, so you cannot
build once and submit to either endpoint (the pre-3.0 "build once" pattern for
manage-list is gone).

## Builder fields

All builders take `chain_id: number` and `nonce: number`. Fields below are the
*additional* ones. `value`/amount fields are **decimal strings in base units**.
Addresses are EIP-55 `0x…` strings. Every operation below accepts the `memo`
option except `batchPayment` (see [Memo](#memo-always-sent-on-v2) below).

### payment → transactions.payment
```typescript
TransactionBuilder.payment({ chain_id, nonce, recipient, value, token }, { memo });
```

### batchPayment → transactions.batchPayment
```typescript
TransactionBuilder.batchPayment({
  chain_id, nonce,
  token: string,
  operations: { recipient: string; amount: string }[], // must not be empty
  max_fee: string,
  created_at: number,        // unix seconds
  operations_hash?: string,  // 0x… 32-byte hash — trailing optional field
  batch_id?: string,         // trailing optional field
});
```
`batchPayment` is the one operation with no memo at all — but the public
wrapper still accepts the same `{ memo }` options argument every other
operation does, and **throws** `does not carry a memo` if you pass one, just
like calling `prepareTransactionV2('batchPayment', unsigned, { memo })`
directly. Both entry points reject a memo identically; a plain-JavaScript
caller passing `{ memo }` gets the same thrown error a TypeScript caller
would, not a silently dropped memo.
`operations_hash` and `batch_id` are positionally trailing in the signed
payload: supplying `batch_id` without `operations_hash` still reserves the
`operations_hash` slot (encoded as an empty placeholder) so decoding stays
positional. Supply whichever ones the node's business rules for this batch
require. `null` is treated exactly like an absent field for both — the
encoder, the signed digest, and the JSON wire body all omit the field
outright — since a `null` (e.g. after a JSON or SQL round-trip) taking the
"present" branch in one but not the other would desync the signed digest
from the transmitted body. When genuinely present, `batch_id` must be a
string and `operations_hash` must be a `0x…` 32-byte hash; both are
validated at `prepare` time.

### tokenIssue → tokens.issueToken
```typescript
TransactionBuilder.tokenIssue({
  chain_id, nonce,
  symbol: string;
  name: string;
  decimals: number;
  master_authority: string;
  is_private: boolean;
  clawback_enabled?: boolean; // default true
}, { memo });
// response includes the new token's address: { hash, token }
```

### tokenMint → tokens.mintToken
```typescript
TransactionBuilder.tokenMint({ chain_id, nonce, recipient, value, token }, { memo });
```

### tokenBurn → tokens.burnToken
```typescript
TransactionBuilder.tokenBurn({ chain_id, nonce, value, token }, { memo });
```

### tokenAuthority → tokens.grantAuthority
```typescript
import { AuthorityAction, AuthorityType } from '@1money/protocol-ts-sdk/api';
TransactionBuilder.tokenAuthority({
  chain_id, nonce,
  action: AuthorityAction;        // Grant | Revoke
  authority_type: AuthorityType;  // see enum below
  authority_address: string;
  token: string;
  value?: string;                 // e.g. mint/burn allowance; wire-defaults to '0'
}, { memo });
```

### tokenBlacklist → tokens.manageBlacklist
### tokenWhitelist → tokens.manageWhitelist
```typescript
import { ManageListAction } from '@1money/protocol-ts-sdk/api';
TransactionBuilder.tokenBlacklist({ chain_id, nonce, action: ManageListAction /* Add | Remove */, address, token }, { memo });
TransactionBuilder.tokenWhitelist({ chain_id, nonce, action: ManageListAction, address, token }, { memo });
```
These have identical field shapes but are **not interchangeable** the way the
old `tokenManageList` was — each has its own `operationType` and signing hash,
so build and sign the one you intend to submit.

### tokenPause → tokens.pauseToken
```typescript
import { PauseAction } from '@1money/protocol-ts-sdk/api';
TransactionBuilder.tokenPause({ chain_id, nonce, action: PauseAction /* Pause | Unpause */, token }, { memo });
```

### tokenMetadata → tokens.updateMetadata
```typescript
TransactionBuilder.tokenMetadata({
  chain_id, nonce,
  name: string;
  uri: string;
  token: string;
  additional_metadata: { key: string; value: string }[];
}, { memo });
```

### tokenBridgeAndMint → tokens.bridgeAndMint
```typescript
TransactionBuilder.tokenBridgeAndMint({
  chain_id, nonce,
  recipient: string;
  value: string;
  token: string;
  source_chain_id: number;
  source_tx_hash: string;
  bridge_metadata: string;
}, { memo });
```

### tokenBurnAndBridge → tokens.burnAndBridge
```typescript
TransactionBuilder.tokenBurnAndBridge({
  chain_id, nonce,
  sender: string;
  value: string;
  token: string;
  destination_chain_id: number;
  destination_address: string;
  escrow_fee: string;
  bridge_metadata: string;
  bridge_param: string; // bytes as 0x… hex ('0x' for empty)
}, { memo });
```

### tokenClawback → tokens.clawbackToken
```typescript
TransactionBuilder.tokenClawback({ chain_id, nonce, token, from, recipient, value }, { memo });
```

### createMultisig → accounts.createMultisig
```typescript
TransactionBuilder.createMultisig({
  chain_id, nonce,
  signers: { public_key: string; weight: number }[]; // 0x… 33-byte SEC1-compressed key
  threshold: number;
}, { memo });
// response is only { hash } — the node does not echo the derived address.
// Compute it yourself, before submitting, with deriveMultisigAddress.
```
The signed payload encodes each `public_key` as a byte list (matching the L1
`Vec<u8>` field), and the JSON `request` body sent over the wire encodes
`signers[].public_key` as a **plain array of byte numbers**, not a hex string
— e.g. `{ public_key: [2, 17, 17, …], weight: 1 }`. This only matters if you
inspect or log `authorized.request` directly; the builder does the conversion
for you.

`createMultisig` validates that each `public_key` is 33 bytes of `0x…` hex,
that no two signers share the same public key, and that `threshold` does not
exceed the total signer weight — the same three checks the node itself runs
(`om-primitives::MultiSigAccountV1::validate`) and that
`deriveMultisigAddress` below already enforces. It does **not** check that a
key is a real point on secp256k1 (a bad key just costs a rejected transaction
at the node, and off-curve dummy keys are load-bearing for the frozen
`CreateMultiSig_single` conformance vector). `deriveMultisigAddress` below is
the address-computing counterpart and does validate the curve point, because
handing back an address for an unusable key would be a fund-losing bug.

## Memo (always sent on v2)

Unlike the pre-3.0 scheme, where an absent memo took a different code path
from a present one, on the v2 surface **every memo-capable operation always
sends a `memo` object on the wire** — there is no "no memo" request shape.
Omitting the `{ memo }` option is shorthand for the all-empty memo:

```typescript
import type { Memo } from '@1money/protocol-ts-sdk';

// These two calls are equivalent — both send { type: '', format: '', data: '' }:
TransactionBuilder.payment(unsigned);
TransactionBuilder.payment(unsigned, { memo: {} });

// A populated memo is a different signing hash, not a different envelope:
TransactionBuilder.payment(unsigned, {
  memo: { type: 'invoice', format: 'text', data: 'order-12345' },
});
```

The unsigned payload passed as the **first** argument must never itself carry
a `memo` property — that field only exists as the second-argument `{ memo }`
option. `WithoutMemo<T>` only catches this at compile time for an inline
object literal; a caller migrating a v1-shaped payload *variable* (or any
plain-JS caller) can still pass one in, so `prepare` throws
`[1Money SDK]: <op> unsigned payload must not include a memo property` if it
finds one, rather than silently dropping it and signing/sending the all-empty
memo instead.

`batchPayment` is the one exception: it is not memo-capable at all. Its
builder wrapper still accepts the same `{ memo }` options argument every
other operation does — passing `{ memo }` is not a compile error, for
TypeScript or JavaScript callers — but it **throws**
`[1Money SDK]: batchPayment does not carry a memo` at prepare time rather
than silently dropping the field. TypeScript and JavaScript callers get the
identical thrown error; there is no silent drop in either case. See
[`batchPayment`](#batchpayment--transactionsbatchpayment) above.

Validation runs at `prepare` time (mirrors the server's Rust rules) and throws
`MemoValidationError` (carries a `.code`) on violation:

| Field | Cap | Allowed chars |
| --- | --- | --- |
| `type` | 128 bytes (UTF-8) | URL-safe (RFC 3986 unreserved + gen/sub-delims + `%`) |
| `format` | 64 bytes (UTF-8) | URL-safe (same set) |
| `data` | 256 bytes (UTF-8) | any non-control: rejects NUL, C0/C1 controls, surrogates |

Error codes: `MEMO_TYPE_TOO_LONG`, `MEMO_TYPE_INVALID_CHARS`,
`MEMO_FORMAT_TOO_LONG`, `MEMO_FORMAT_INVALID_CHARS`, `MEMO_DATA_TOO_LONG`,
`MEMO_DATA_CONTROL_CHARS`, `MEMO_TOO_LARGE`. On the read side, the
`Transaction` union carries `memo?` back; the receipt types do not include it.

## Enums (import from `@1money/protocol-ts-sdk/api`)

```typescript
enum AuthorityType {
  MasterMint     = 'MasterMintBurn',
  MintBurnTokens = 'MintBurnTokens',
  Pause          = 'Pause',
  ManageList     = 'ManageList',
  UpdateMetadata = 'UpdateMetadata',
  Bridge         = 'Bridge',
  Clawback       = 'Clawback',
}
enum AuthorityAction  { Grant = 'Grant', Revoke = 'Revoke' }
enum ManageListAction { Add = 'Add', Remove = 'Remove' }
enum PauseAction      { Pause = 'Pause', Unpause = 'Unpause' }
```

## deriveMultisigAddress — compute the account address before submitting

`createMultisig` only returns `{ hash }`; the node never echoes the resulting
multisig account address. Compute it locally, before you submit, with the
same derivation the node uses:

```typescript
import { deriveMultisigAddress } from '@1money/protocol-ts-sdk';

const address = deriveMultisigAddress(
  [
    { public_key: '0x02...', weight: 1 },
    { public_key: '0x03...', weight: 1 },
  ],
  2 // threshold
); // → '0x…' the account address funds should be sent to
```

This is `keccak256("MULTISIG_V1" || sorted(pubkey || weight) || threshold_be_u16)`,
truncated to the last 20 bytes — byte-for-byte identical to what the node
assigns at execution. It's pure and side-effect free, so call it before
building the transaction to confirm the address you expect, and it throws on
an empty signer list, an invalid/off-curve public key, a non-canonical
(non-SEC1-compressed) key encoding, a zero/negative weight, a **weight over
255** (each signer's weight is packed as a single byte in the address
preimage), a **duplicate public key**, a weight sum that overflows `u16`, or a
threshold exceeding the total signer weight.

> **`createMultisig` and `deriveMultisigAddress` now reject the same
> configurations:** both enforce the same node-side numeric bounds (`weight`
> a positive integer `<= 255`, a node-side `u8`; `threshold` a positive
> integer `<= 65535`, a node-side `u16`), both reject a **duplicate public
> key**, and both reject a `threshold` exceeding the total signer weight —
> `createMultisig({ ..., threshold: 3 }, /* two signers, weight 1 each */)`
> now throws at `prepare` time with the same "exceeds total signer weight"
> message `deriveMultisigAddress` throws, instead of signing a configuration
> the node would certainly reject and burning the nonce. The one deliberate
> remaining asymmetry: `deriveMultisigAddress` additionally rejects an
> off-curve or non-canonically-encoded public key (it hands back an address
> someone may fund, so a bad key there is a fund-losing bug), while
> `createMultisig` does not curve-check (a bad key there just costs a
> rejected transaction, and off-curve dummy keys are load-bearing for the
> frozen `CreateMultiSig_single` conformance vector). Still call
> `deriveMultisigAddress` before submitting if you need the account address —
> it remains the stricter check on the public key itself.

## Custom signer (wallet / HSM / no raw key in process)

When the private key lives in a browser wallet, KMS, or HSM, implement the
`SignerAdapter` interface instead of `createPrivateKeySigner`. You only need to
sign `prepared.signingHash` and return `{ r, s, v }` (low-S, and `v` must end
up `0` or `1` before you call `.authorize()`). `authorize()` itself enforces
the low-S bound (the same check the legacy path always ran) and throws
`[1Money SDK]: Invalid signature - high S value detected (potential
malleability)` if your signer doesn't normalize `s` — this fails fast
locally instead of the node rejecting the transaction after submission
(`om-crypto-types::CryptoError::HighSSignature`). Some HSM/KMS/MPC signers
don't normalize by default; check your provider's docs, or normalize `s`
yourself (`s' = N - s` when `s > N/2`) before returning it:

```typescript
import type { SignerAdapter, Signature } from '@1money/protocol-ts-sdk';

const walletSigner: SignerAdapter = {
  async signDigest(digest): Promise<Signature> {
    // digest === prepared.signingHash, a 0x-prefixed 32-byte hex string.
    // Produce a low-S secp256k1 signature however your key custody allows.
    return { r: '0x…', s: '0x…', v: 0 };
  },
};

const signature = await walletSigner.signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);
```

`v` may be `number` (recovery id, `0`/`1`) or `boolean` going into `authorize`;
`authorize` normalizes it and throws
`[1Money SDK]: Invalid signature v for native v2: … (must be 0 or 1)` for
anything else — including a legacy `27`/`28`, which is **rejected, not
converted**. Seeing that error means the digest that got signed was the wrong
one (e.g. a legacy-scheme digest signed and handed to the v2 `authorize`).

## Alternate path: EIP-712 typed-data payment

Independent of both the v2 REST flow and the legacy v1 REST flow, the SDK
exports a **separate EIP-712 typed-data path for payments** (root-level
export, via the signing layer). Use it when the signer is a browser wallet
doing `eth_signTypedData_v4` and you submit on-chain calldata to a
`submitTypedData` contract entrypoint — *not* any REST `transactions.payment`
endpoint. Today only payment is implemented, and it is unaffected by the 3.0
v2/legacy split.

```typescript
import { preparePaymentTypedTx, parseSig } from '@1money/protocol-ts-sdk';

const prepared = preparePaymentTypedTx({
  chain_id, nonce, recipient, value, token,
  memo: { data: 'note' }, // optional, same Memo rules
});

// 1. Hand prepared.typedData to the wallet for eth_signTypedData_v4.
const sigHex = await wallet.request({
  method: 'eth_signTypedData_v4',
  params: [account, JSON.stringify(prepared.typedData)],
});

// 2. Parse the 65-byte sig (normalizes v to 27/28) and build the calldata.
const tx = prepared.encodeCalldata(parseSig(sigHex));
// → { to, data, value: 0n, gas, gasPrice, type: 'legacy' } — send via your wallet.
```

`encodeCalldata` requires `v ∈ {27, 28}` (recovery ids `0`/`1` are normalized by
`parseSig`) — the opposite convention from the v2 REST surface's `authorize`,
which requires `0`/`1` and rejects `27`/`28`. Don't mix the two conventions up.
The EIP-712 domain is `{ name: '1Money Network', version: '1', chainId,
verifyingContract: 0xff…fe }`; `buildPaymentEip712TypedData` is exported if
you need the typed data without the calldata helper.

## Verifying the result

After submit you get a `{ hash }` (and `{ token }` for issue). Confirm it
landed:

```typescript
const receipt = await client.transactions.getReceiptByHash(hash);
console.log(receipt.success ? 'confirmed' : 'failed', 'fee:', receipt.fee_used);
```

Receipts may not be available immediately — poll `getReceiptByHash` (or
`getFinalizedByHash` for finality) with a short backoff rather than a single
call.

If `client.<module>.<method>(authorized)` throws `TransactionHashMismatchError`
instead, **do not retry** — `submitted` is `true` on that error, meaning the
node already accepted the transaction before the mismatch was detected.
Retrying resubmits a *second* transaction on the same nonce. See
`client-and-errors.md`.

## Legacy v1

The pre-3.0 signing scheme is still available, namespaced under
`LegacyV1TransactionBuilder` and `api().<module>.legacyV1.*`, as an explicit
opt-in during the migration window. A node whose `NativeWriteMode` is
`'v2_only'` (the runtime value of `native_write_mode` — lowercase, not
`V2Only`) rejects every legacy write with 410 — check
`client.status.getNativeWriteStatus()` before relying on it (see
`api-reference.md` and `client-and-errors.md`).

```typescript
import { api, LegacyV1TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });

const prepared = LegacyV1TransactionBuilder.payment({ chain_id, nonce, recipient, value, token });
// legacy PreparedTx: .signatureHash, .rlpBytes, .unsigned, .kind
const signed = await prepared.sign(createPrivateKeySigner(privateKey));
// legacy SignedTx: .toRequest(), .txHash, .signature, .signatureHash, .unsigned
const { hash } = await client.transactions.legacyV1.payment(signed.toRequest());
```

`LegacyV1TransactionBuilder` covers eleven operations:
`payment`, `tokenManageList`, `tokenBurn`, `tokenAuthority`, `tokenIssue`,
`tokenMint`, `tokenPause`, `tokenMetadata`, `tokenBridgeAndMint`,
`tokenBurnAndBridge`, `tokenClawback` — matched by `api().<module>.legacyV1.*`
methods of the same name family (e.g. `tokens.legacyV1.manageBlacklist` /
`tokens.legacyV1.manageWhitelist` both take the single legacy
`tokenManageList` shape). There is no legacy `batchPayment` or `createMultisig`
— those are v2-only.

`LegacyV1TransactionBuilder.tokenAuthority`'s request body also defaults an
omitted `value` to `'0'`, same as the v2 wire path above: the node's
`TokenAuthorityPayload.value` is a non-optional `U256` with no
`#[serde(default)]`, so the signed bytes always encode `value = 0` when it's
omitted, and the transmitted body now matches — it used to omit the field
entirely and 400.

The legacy builder still accepts an optional `memo?: Memo` per operation; on
that scheme (unlike v2) an **absent** memo takes a byte-identical-to-pre-memo
V1 path, while a **present** memo (even `{}`) switches to a disjoint-hash V2
envelope — the opposite default from the current v2-by-default surface. Don't
port assumptions between the two schemes.

Do not treat a `legacyV1` failure as a reason to retry the same transaction on
the v2 surface, or vice versa: each scheme signs a different digest, so
"retrying under the other scheme" is really submitting a brand-new signed
transaction — safe only if you re-prepare and re-sign, and only if you are
certain the first attempt was never accepted (see `TransactionHashMismatchError`
in `client-and-errors.md`).

## Common mistakes

- **Wrong builder/endpoint pairing** — e.g. building `tokenMint` but calling
  `tokens.issueToken`. Use the map above. `submitAuthorized` now checks
  `authorized.operation` against the method you called it through and throws
  synchronously (before any network call) on a mismatch, so this fails loudly
  instead of quietly POSTing to the wrong route.
- **Treating `tokenBlacklist`/`tokenWhitelist` as interchangeable** — each has
  its own signing hash; you cannot sign once and submit to either.
- **Numeric amounts** — `value: 1` or `value: 1.5` is wrong; use a base-unit
  string like `'1000000000000000000'`.
- **Stale nonce across multiple txs** — re-fetch or locally increment `nonce`
  between sequential sends from the same sender.
- **Confusing `prepared.signingHash` (v2) with `prepared.signatureHash`
  (legacy v1)** — different property name, different domain, different value.
- **A `v` of `27`/`28` on the v2 surface** — rejected outright, not normalized.
  That value only belongs to the EIP-712 typed-data path.
- **Retrying after `TransactionHashMismatchError`** — the transaction was
  already accepted; retrying creates a second one on the same nonce.
- **Reaching for `signMessage`/`encodePayload`** — deprecated; use a builder.
