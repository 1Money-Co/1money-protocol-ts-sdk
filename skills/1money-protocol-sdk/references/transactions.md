# Building, signing & submitting transactions

Every write follows the same pipeline. Internalize this shape; the rest is just
filling in builder-specific fields.

```typescript
import { api, TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });

// 1. Inputs every tx needs. Awaiting directly returns the body; it throws on
//    error (or attach .success/.error handlers — see client-and-errors.md).
const { chain_id } = await client.chain.getChainId();
const { nonce } = await client.accounts.getNonce(sender);

// 2. Build (validates fields, RLP-encodes, prepares the digest).
const prepared = TransactionBuilder.<type>({ chain_id, nonce, /* ...fields */ });

// 3. Sign → request body → submit to the matching endpoint.
const signed = await prepared.sign(createPrivateKeySigner(privateKey));
const res = await client.<module>.<method>(signed.toRequest());
```

## What the objects give you

`TransactionBuilder.<type>(...)` returns a **PreparedTx**:
- `prepared.signatureHash` — the 32-byte digest a signer must sign.
- `prepared.rlpBytes`, `prepared.unsigned`, `prepared.kind`.
- `await prepared.sign(signer)` → **SignedTx**.
- `prepared.attachSignature(signature)` → **SignedTx** (when you signed the
  `signatureHash` elsewhere and just want to attach r/s/v).

`SignedTx`:
- `signed.toRequest()` — the request body (unsigned fields + `signature`) you
  pass to the submit method.
- `signed.txHash` — the on-chain transaction hash (available before submit).
- `signed.signature` (`{ r, s, v }`), `signed.signatureHash`, `signed.unsigned`.

`createPrivateKeySigner(privateKey: \`0x${string}\`)` produces a `SignerAdapter`
that signs with low-S (required — high-S signatures are rejected on attach).

## Builder ↔ endpoint map

| `TransactionBuilder.…` | Submit `client.…` | Returns |
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

## Builder fields

All builders take `chain_id: number` and `nonce: number`. Fields below are the
*additional* ones. `value`/amount fields are **decimal strings in base units**.
Addresses are EIP-55 `0x…` strings.

**Every builder also accepts an optional `memo?: Memo`** (see [Memo](#memo-optional--v1-vs-v2-envelope) below). Omit it for the common case; the fields listed per builder are the required ones.

### payment → transactions.payment
```typescript
{ recipient: string; value: string; token: string }
```

### tokenIssue → tokens.issueToken
```typescript
{
  symbol: string;
  name: string;
  decimals: number;
  master_authority: string;
  is_private: boolean;
  clawback_enabled?: boolean; // default true
}
// response includes the new token's address: { hash, token }
```

### tokenMint → tokens.mintToken
```typescript
{ recipient: string; value: string; token: string }
```

### tokenBurn → tokens.burnToken
```typescript
{ value: string; token: string }
```

### tokenAuthority → tokens.grantAuthority
```typescript
import { AuthorityAction, AuthorityType } from '@1money/protocol-ts-sdk/api';
{
  action: AuthorityAction;        // Grant | Revoke
  authority_type: AuthorityType;  // see enum below
  authority_address: string;
  token: string;
  value?: string;                 // e.g. mint/burn allowance
}
```

### tokenManageList → tokens.manageBlacklist / tokens.manageWhitelist
```typescript
import { ManageListAction } from '@1money/protocol-ts-sdk/api';
{ action: ManageListAction; address: string; token: string } // Add | Remove
```
Build once, then submit to `manageBlacklist` *or* `manageWhitelist` — the payload
shape is identical; the endpoint decides which list.

### tokenPause → tokens.pauseToken
```typescript
import { PauseAction } from '@1money/protocol-ts-sdk/api';
{ action: PauseAction; token: string } // Pause | Unpause
```

### tokenMetadata → tokens.updateMetadata
```typescript
{
  name: string;
  uri: string;
  token: string;
  additional_metadata: { key: string; value: string }[];
}
```

### tokenBridgeAndMint → tokens.bridgeAndMint
```typescript
{
  recipient: string;
  value: string;
  token: string;
  source_chain_id: number;
  source_tx_hash: string;
  bridge_metadata: string;
}
```

### tokenBurnAndBridge → tokens.burnAndBridge
```typescript
{
  sender: string;
  value: string;
  token: string;
  destination_chain_id: number;
  destination_address: string;
  escrow_fee: string;
  bridge_metadata: string;
  bridge_param: string; // bytes as 0x… hex ('0x' for empty)
}
```

### tokenClawback → tokens.clawbackToken
```typescript
{ token: string; from: string; recipient: string; value: string }
```

## Memo (optional — V1 vs V2 envelope)

Any builder accepts an optional `memo` to attach a structured note. `Memo` is
imported from the package root (or `/utils`); all three subfields are optional:

```typescript
import type { Memo } from '@1money/protocol-ts-sdk';

const prepared = TransactionBuilder.payment({
  chain_id, nonce, recipient, value, token,
  memo: { type: 'invoice', format: 'text', data: 'order-12345' }, // all subfields optional
});
```

What it changes — this is **not cosmetic**:

- **Absent memo (`undefined`/`null`) → V1 path.** RLP bytes are byte-identical to
  the pre-memo SDK; `prepared.kind` is e.g. `'payment'`.
- **Present memo (even `{}` with empty subfields) → V2 envelope.** The builder
  RLP-encodes `[innerList, [type, format, data]]`, `prepared.kind` becomes
  `'<kind>_v2'`, and the **signature hash and tx hash live in a different domain**
  — a V1 and a V2 tx with otherwise identical fields produce different hashes.
  So passing `memo: {}` is a meaningful choice, not a no-op.

Validation runs at build time (mirrors the server's Rust rules) and throws
`MemoValidationError` (carries a `.code`) on violation:

| Field | Cap | Allowed chars |
| --- | --- | --- |
| `type` | 128 bytes (UTF-8) | URL-safe (RFC 3986 unreserved + gen/sub-delims + `%`) |
| `format` | 64 bytes (UTF-8) | URL-safe (same set) |
| `data` | 256 bytes (UTF-8) | any non-control: rejects NUL, C0/C1 controls, surrogates |

Error codes: `MEMO_TYPE_TOO_LONG`, `MEMO_TYPE_INVALID_CHARS`,
`MEMO_FORMAT_TOO_LONG`, `MEMO_FORMAT_INVALID_CHARS`, `MEMO_DATA_TOO_LONG`,
`MEMO_DATA_CONTROL_CHARS`, `MEMO_TOO_LARGE`. On the read side, the `Transaction`
union carries `memo?` back (populated only for V2 transactions); the receipt
types do not include it.

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

## Worked example: issue a token, then read its address

```typescript
import { api, TransactionBuilder, createPrivateKeySigner } from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });
const master = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;

const { chain_id } = await client.chain.getChainId();
const { nonce } = await client.accounts.getNonce(master);

const prepared = TransactionBuilder.tokenIssue({
  chain_id, nonce,
  symbol: 'MTK', name: 'My Token', decimals: 18,
  master_authority: master,
  is_private: true,
  clawback_enabled: true,
});

const signed = await prepared.sign(createPrivateKeySigner(privateKey));
const { hash, token } = await client.tokens.issueToken(signed.toRequest());
console.log('issued token', token, 'in tx', hash);
```

## Custom signer (wallet / HSM / no raw key in process)

When the private key lives in a browser wallet, KMS, or HSM, implement the
`SignerAdapter` interface instead of `createPrivateKeySigner`. You only need to
sign `prepared.signatureHash` and return `{ r, s, v }` (low-S):

```typescript
import type { SignerAdapter, Signature } from '@1money/protocol-ts-sdk';

const walletSigner: SignerAdapter = {
  async signDigest(digest): Promise<Signature> {
    // digest === prepared.signatureHash, a 0x-prefixed 32-byte hex string.
    // Produce a low-S secp256k1 signature however your key custody allows.
    return { r: '0x…', s: '0x…', v: 0 };
  },
};

const signed = await prepared.sign(walletSigner);
// or, if you already have the signature object:
const signed2 = prepared.attachSignature({ r: '0x…', s: '0x…', v: 0 });
```

`v` may be `number` (recovery id, e.g. `0`/`1`) or `boolean`. `attachSignature`
throws on high-S signatures (malleability guard), so ensure your signer enforces
low-S.

## Alternate path: EIP-712 typed-data payment

Besides the RLP `TransactionBuilder` flow above, the SDK exports a **separate
EIP-712 typed-data path for payments** (root-level export, via the signing
layer). Use it when the signer is a browser wallet doing
`eth_signTypedData_v4` and you submit on-chain calldata to a `submitTypedData`
contract entrypoint — *not* the REST `transactions.payment` endpoint. Today only
payment is implemented.

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
`parseSig`). The EIP-712 domain is `{ name: '1Money Network', version: '1',
chainId, verifyingContract: 0xff…fe }`; `buildPaymentEip712TypedData` is exported
if you need the typed data without the calldata helper. This path is independent
of the `api()` REST client.

## Verifying the result

After submit you get a `{ hash }` (and `{ token }` for issue). Confirm it landed:

```typescript
const receipt = await client.transactions.getReceiptByHash(hash);
console.log(receipt.success ? 'confirmed' : 'failed', 'fee:', receipt.fee_used);
```

Receipts may not be available immediately — poll `getReceiptByHash` (or
`getFinalizedByHash` for finality) with a short backoff rather than a single
call.

## Common mistakes

- **Wrong builder/endpoint pairing** — e.g. building `tokenMint` but calling
  `tokens.issueToken`. Use the map above.
- **Numeric amounts** — `value: 1` or `value: 1.5` is wrong; use a base-unit
  string like `'1000000000000000000'`.
- **Stale nonce across multiple txs** — re-fetch or locally increment `nonce`
  between sequential sends from the same sender.
- **Forgetting `.toRequest()`** — you submit the SignedTx's request body, not the
  PreparedTx or the SignedTx object itself.
- **Reaching for `signMessage`/`encodePayload`** — deprecated; use the builder.
