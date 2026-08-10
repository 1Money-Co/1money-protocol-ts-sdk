# Transactions API

The Transactions API provides access to transaction-related endpoints.

## Usage

```typescript
import { api } from '@1money/protocol-ts-sdk/api';

// Initialize the API client
const apiClient = api();

// Use the transactions API
// To be implemented
```

## Available Endpoints

- `getByHash`, `getReceiptByHash`, `getFinalizedByHash`, `estimateFee`,
  `estimateBatchPaymentFee` — reads/unsigned estimates, always against `/v1`.
  The Batch Payment estimator is `POST /v1/transactions/batch_payment/estimate_fee`.
- `payment`, `batchPayment` — native v2 writes. Take an `AuthorizedTxV2` built
  via `TransactionBuilder.payment(...)` / `TransactionBuilder.batchPayment(...)`
  followed by `.authorize(signature)`, and POST to `/v2/transactions/payment`
  / `/v2/transactions/batch_payment`. See the root `../../../skills/1money-protocol-sdk/references/transactions.md`
  for the full prepare → sign → authorize → submit flow.
- `legacyV1.payment` — the pre-3.0 signed-payload path, explicit opt-in during
  the migration window. POSTs to `/v1/transactions/payment` and is rejected
  with 410 once the node's `native_write_mode` reaches `'v2_only'` (the
  runtime value is a lowercase string, not an enum member). There is no
  `legacyV1.batchPayment` — batch payment is v2-only.

`getByHash` returns a discriminated `Transaction` union. The union includes
`transaction_type: 'BatchPayment'` with `BatchPaymentData` and
`transaction_type: 'CreateMultiSig'` with `CreateMultiSigData`, including the
node-derived `multisig_address`.

### Memo field

On the v2 surface (`payment` and `batchPayment`), the request always carries a `memo` object —
omitting the `memo` option when building sends the all-empty
`{ type: '', format: '', data: '' }`, which is itself a specific signed value,
not an omitted field:

```ts
interface Memo {
  type?: string;    // ≤128 UTF-8 bytes, URL-safe charset
  format?: string;  // ≤64 UTF-8 bytes, URL-safe charset
  data?: string;    // ≤256 UTF-8 bytes, no control characters
}
```

On the `legacyV1` surface, an **absent** `memo` takes the byte-identical
pre-memo legacy path; a **present** `memo` (even `{}`) switches to a disjoint
transaction-hash domain. This absent/present distinction does not apply to
the v2 surface, which always sends a memo.

Validation runs at builder time (for both surfaces) and throws
`MemoValidationError` with codes (`MEMO_TYPE_INVALID_CHARS`,
`MEMO_DATA_CONTROL_CHARS`, `MEMO_TOO_LARGE`, etc.) matching the server's error
codes 1:1.

## Batch Payment lifecycle

Batch Payment has one public, canonical native-v2 lifecycle: estimate →
prepare → sign → authorize → submit → read. The SDK exposes no legacy Batch
Payment write, even if a node retains a deprecated v1 route.

```typescript
import {
  api,
  TransactionBuilder,
  calculateBatchPaymentOperationsHash,
  createPrivateKeySigner,
} from '@1money/protocol-ts-sdk';

const client = api({ network: 'testnet' });
const token = '0x2cd8999Be299373D7881f4aDD11510030ad1412F';
const operations = [
  { recipient: '0xa128999Be299373D7881f4aDD11510030ad13512', amount: '1000' },
  { recipient: '0x6324dAc598f9B637824978eD6b268C896E0c40E0', amount: '2000' },
];

// Unsigned, non-binding quote. It returns { fee: string, plan?: string }.
const quote = await client.transactions.estimateBatchPaymentFee({
  from: sender,
  token,
  operations,
});

const { chain_id } = await client.chain.getChainId();
const { nonce } = await client.accounts.getNonce(sender);
const prepared = TransactionBuilder.batchPayment(
  {
    chain_id,
    nonce,
    token,
    operations,
    created_at: Math.floor(Date.now() / 1000),
    operations_hash: calculateBatchPaymentOperationsHash(operations),
    batch_id: 'payroll-2026-08',
  },
  {
    memo: {
      type: 'purpose/SALA',
      format: 'text/plain',
      data: 'payroll-2026-08',
    },
  }
);
const signature = await createPrivateKeySigner(privateKey).signDigest(
  prepared.signingHash
);
const authorized = prepared.authorize(signature);
const { hash } = await client.transactions.batchPayment(authorized);

// The v2 submit path verifies this equality before it returns.
console.log(hash === authorized.transactionHash);
```

`operations_hash` is optional, but if supplied it must equal
`calculateBatchPaymentOperationsHash(operations)`; a mismatch fails locally
before signing. `batch_id` is signed correlation metadata only — it has no
uniqueness, deduplication, idempotency, or replay guarantee. `max_fee` has been
removed from Batch Payment: quotes are never signed or treated as fee caps.

Batch Payment is memo-capable. Omitting the `memo` option still signs and sends
the three empty strings `{ type: '', format: '', data: '' }`. Actual sender
debit is the operation total plus the receipt's actual `fee_used`, not the
estimate. Batch enablement, maximum operation count, encoded-size limit, and
fee asset are governed by the node, so even a successful quote is non-binding.
If one operation cannot execute, recipients, sender debit, and operator fee
movement all roll back atomically.

Read the receipt by the returned hash for the outcome. For Batch Payment,
`success_info.receiver` is the zero-address sentinel because there is no one
recipient. Obtain actual recipients and amounts from `PaymentExecuted` entries
in `execution_events`. `batch_info.failure` is currently `null` in production
responses; it is reserved for forward compatibility and not a terminal-failure
signal.

## Response compatibility

All receipt callers should update with this release: `fee_used` is now a string
to preserve precision, and `to` is replaced by `recipient`. The same common
fields are inherited by `FinalizedTransactionReceipt`. `EstimateFee` is shared
by both estimate methods, so its existing `estimateFee()` response now also
includes optional `plan?: string`.
