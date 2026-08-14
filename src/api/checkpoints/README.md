# Checkpoints API

The Checkpoints API provides access to checkpoint-related endpoints.

## Usage

```typescript
import { api } from '@1money/protocol-ts-sdk/api';

// Initialize the API client
const apiClient = api();

// Use the checkpoints API
apiClient.checkpoints.getNumber()
  .success(response => {
    console.log('Current checkpoint number:', response.number);
  })
  .error(error => {
    console.error('Error fetching checkpoint number:', error);
  });
```

## Available Endpoints

### `getNumber()`

Returns the current checkpoint number.

**API Endpoint:** `https://api.testnet.1money.network/v1/checkpoints/number`

**Example Response:**

```json
{
  "number": 147411
}
```

## Testing

Unit tests for the structure of this API client run with:

```bash
npm test
```

The tests that make real API calls to the remote endpoint live in the
integration suite (`src/__integration__/checkpoints-api.test.ts`), not
in `npm test`, so the unit suite stays deterministic and network-free.
Run them with:

```bash
npm run test:integration:local
```

### Example

There's also an example test that demonstrates how to use the API:

```bash
npx mocha --config .mocharc.js src/api/checkpoints/__test__/example.test.ts
```

This will fetch and display the current checkpoint number from the API.
