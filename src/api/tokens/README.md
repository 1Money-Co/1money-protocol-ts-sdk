# Tokens API

The Tokens API provides access to token-related endpoints.

## Usage

```typescript
import { api } from '@1money/protocol-ts-sdk/api';

// Initialize the API client
const apiClient = api();

// Use the tokens API
// To be implemented
```

## Available Endpoints

- `getTokenMetadata` — read, always against `/v1`.
- `issueToken`, `mintToken`, `burnToken`, `grantAuthority`, `manageBlacklist`,
  `manageWhitelist`, `pauseToken`, `updateMetadata`, `bridgeAndMint`,
  `burnAndBridge`, `clawbackToken` — native v2 writes. Each takes an
  `AuthorizedTxV2` built via the matching `TransactionBuilder.<op>(...)
  .authorize(signature)` (e.g. `manageBlacklist` pairs with
  `TransactionBuilder.tokenBlacklist`, `manageWhitelist` with
  `TransactionBuilder.tokenWhitelist` — these are distinct v2 operations, not
  a shared "manage list" builder) and POSTs to the matching `/v2/tokens/*`
  route.
- `legacyV1.*` — the pre-3.0 signed-payload path for the same eleven
  operations (`legacyV1.manageBlacklist` and `legacyV1.manageWhitelist` both
  take the single legacy `TokenManageListPayload` shape), explicit opt-in
  during the migration window. POSTs to `/v1/tokens/*` and is rejected with
  410 once the node reaches `NativeWriteMode.V2Only`.

### Memo field

All v2 write methods in this module accept a request built with an optional
`memo` option, which is always sent on the wire (empty subfields by default).
See `../transactions/README.md` for the full description of memo semantics,
validation rules, and the legacy-vs-v2 envelope difference.
