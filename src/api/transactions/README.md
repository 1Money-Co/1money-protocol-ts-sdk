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
- `submitAndSettle`, `settle` — send (or resume) an `AuthorizedTxV2` and
  resend the same signed bytes until its receipt appears. See
  [Settling a write](#settling-a-write).
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

## Settling a write

`transactions.submitAndSettle(authorized, options?)` sends a signed transaction
that was never sent; `transactions.settle(authorized, options?)` resumes after an
earlier send (for example after a `TransactionLockedError` or a
`TransactionOutcomeUnknownError`). Both resend the **same signed bytes** on the
node's retry schedule until `getReceiptByHash` returns a receipt for the hash,
and resolve with `{ transactionHash, receipt }`. They never build or sign a
transaction. Read `receipt.success`: a hold debit can execute and still fail.
They copy `authorized` when they start, so a later change to that object does
not change what they send. No send starts after the deadline.

| Option | Default | Meaning |
| --- | --- | --- |
| `resendIntervalMs` | 70 000 | Send k+1 goes out `resendIntervalMs × k` after send k (the node's retry gate: 70, 140, 210, 280 s apart) |
| `pollIntervalMs` | 1 000 | First receipt poll interval; it doubles each poll |
| `maxPollIntervalMs` | 10 000 | Upper bound of the poll interval |
| `deadlineMs` | 900 000 | Stop and throw the error for the last known state |
| `throttleBackoffMs` | 60 000 | Wait after a lookup answered `429` or `retry_later` (a firewall allows about 120 reads per minute per IP address) |
| `nonceUsedGraceMs` | 70 000 | After a send answered `nonce_too_low`, poll the receipt this long, then stop |
| `signal` | — | An `AbortSignal`; abort throws the error for the last known state |

Outcomes:

- Resolves when the receipt for the hash exists.
- `submitAndSettle` throws `TransactionSubmissionError` only when its first
  send was rejected before admission, or answered `nonce_too_low` (it then
  sends nothing more). `settle`
  never throws `TransactionSubmissionError`: a rejected resend says nothing
  about the earlier send.
- If the signal is already aborted, `submitAndSettle` throws a plain `Error`
  and sends nothing.
- A send answered `nonce_too_low` means the nonce is used: the transaction
  executed, or another transaction used the nonce. On the first send of
  `submitAndSettle` the transaction was never sent, so another transaction
  used the nonce: it throws `TransactionSubmissionError` at once. Never pass
  `submitAndSettle` signed bytes that may have been sent; use `settle`.
- After any other send, no send can help, so the helper stops resending and
  polls the receipt for `nonceUsedGraceMs`. Without a receipt it then throws
  the error for the last known state. It never reports "rejected": the receipt
  read can reach a node that has not executed the transaction yet. Nodes that
  send no problem `type` keep the full schedule.
- At the deadline or on abort: `TransactionLockedError` (the node holds the
  transaction) or `TransactionOutcomeUnknownError`, each with `observations`,
  the requests and answers of the run (at most 200, numbered by `seq`).
- `TransactionHashMismatchError` if the node returns another hash.

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
  { recipient: '0xa128999be299373d7881f4add11510030ad13512', amount: '1000' },
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

// The v2 submit path verifies this equality case-insensitively before it returns.
console.log(
  hash.toLowerCase() === authorized.transactionHash.toLowerCase()
);
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

For an intentional rollback check, do not wait indefinitely for a failure
receipt or infer an outcome from `batch_info.failure`. Record balances for the
sender, every intended recipient, and the operator fee recipient before one
submission. After bounded observation of submission and ordinary/finalized
receipt paths, require every recorded balance to be unchanged. Use an isolated
sender so ambiguous nonce or mempool state does not affect other work.

## Response compatibility

All receipt callers should update with this release: `fee_used` is now a string
to preserve precision, and `to` is replaced by `recipient`. The same common
fields are inherited by `FinalizedTransactionReceipt`. `EstimateFee` is shared
by both estimate methods, so its existing `estimateFee()` response now also
includes optional `plan?: string`.
