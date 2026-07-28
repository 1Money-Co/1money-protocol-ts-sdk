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

- `getByHash`, `getReceiptByHash`, `getFinalizedByHash`, `estimateFee` — reads,
  always against `/v1`.
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

### Memo field

On the v2 surface (`payment`), the request always carries a `memo` object —
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
