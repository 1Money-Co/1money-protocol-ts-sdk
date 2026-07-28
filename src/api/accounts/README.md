# Accounts API

The Accounts API provides access to account-related endpoints.

## Usage

```typescript
import { api } from '@1money/protocol-ts-sdk/api';

// Initialize the API client
const apiClient = api();

// Use the accounts API
// To be implemented
```

## Available Endpoints

- `getNonce`, `getBbNonce`, `getTokenAccount` — reads, always against `/v1`.
- `createMultisig` — native v2, **v2-only** write. Takes an `AuthorizedTxV2`
  built via `TransactionBuilder.createMultisig(...).authorize(signature)` and
  POSTs to `/v2/accounts/multisig`. There is no `legacyV1` form and no
  `legacyV1` namespace at all on this module — legacy clients used
  `POST /v1/transactions/raw` for multisig creation, which is retired (410).
  The response is only `{ hash }`; compute the resulting account address
  before submitting with `deriveMultisigAddress` (see
  `../../../skills/1money-protocol-sdk/references/transactions.md`).
