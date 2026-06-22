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

*To be implemented*

### Optional memo field

Every write endpoint (payment, mint, burn, issue, authority, manage list,
pause, metadata, bridge_and_mint, burn_and_bridge, clawback) accepts an
optional `memo` field of shape:

```ts
interface Memo {
  type?: string;    // ≤128 UTF-8 bytes, URL-safe charset
  format?: string;  // ≤64 UTF-8 bytes, URL-safe charset
  data?: string;    // ≤256 UTF-8 bytes, no control characters
}
```

When `memo` is omitted, the request takes the legacy V1 envelope path —
byte-for-byte identical to pre-memo SDK behavior, including transaction
hash. When `memo` is present (even with all subfields empty), the request
takes the V2 envelope path with a disjoint transaction-hash domain; the
client signs over `WithMemo<T>` and the response includes the memo on
`Transaction.memo`.

Validation runs at builder time and throws `MemoValidationError` with
codes (`MEMO_TYPE_INVALID_CHARS`, `MEMO_DATA_CONTROL_CHARS`,
`MEMO_TOO_LARGE`, etc.) matching the server's error codes 1:1.
