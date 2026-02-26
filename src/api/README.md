# API

The API module provides access to the 1Money network API endpoints.

## Structure

The API is organized into the following modules:

- `accounts` - Account-related API endpoints
- `tokens` - Token-related API endpoints
- `transactions` - Transaction-related API endpoints
- `checkpoints` - Checkpoint-related API endpoints

## Usage

```typescript
import { api, CHAIN_IDS } from '@1money/protocol-ts-sdk/api';

// Initialize the API client (defaults to testnet)
const apiClient = api();

// Or specify a different network
const mainnetClient = api({ network: 'mainnet' });
const localClient = api({ network: 'local' });

// You can also specify a custom chain ID if needed
const customClient = api({ chainId: 12345 });

// Access the chain ID for the current network
console.log('Current chain ID:', apiClient.chainId);

// Chain IDs are also available as constants
console.log('Mainnet chain ID:', CHAIN_IDS.MAINNET); // 21210
console.log('Testnet chain ID:', CHAIN_IDS.TESTNET); // 1212101

// Use the API client to make requests
apiClient.checkpoints.getNumber()
  .success(response => {
    console.log('Current checkpoint number:', response.number);
  })
  .error(error => {
    console.error('Error fetching checkpoint number:', error);
  });
```

## Available Endpoints

### Accounts

#### `accounts.getNonce(address)`

Returns the nonce for the specified account address.

**API Endpoint:** `https://api.testnet.1money.network/v1/accounts/nonce?address={address}`

#### `accounts.getTokenAccount(address, token)`

Returns the associated token account for the specified account and token addresses.

**API Endpoint:** `https://api.testnet.1money.network/v1/accounts/token_account?address={address}&token={token}`

### Tokens

#### `tokens.getTokenMetadata(token)`

Returns metadata for the specified token address.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/token_metadata?token={token}`

#### `tokens.setBlacklist(payload)`

Sets the blacklist status for a token address.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/blacklist`

#### `tokens.burnToken(payload)`

Burns tokens.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/burn`

#### `tokens.grantAuthority(payload)`

Grants or revokes token authority.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/grant_authority`

#### `tokens.issueToken(payload)`

Issues a new token.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/issue`

#### `tokens.mintToken(payload)`

Mints tokens.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/mint`

#### `tokens.pauseToken(payload)`

Pauses or unpauses a token.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/pause`

#### `tokens.updateMetadata(payload)`

Updates token metadata.

**API Endpoint:** `https://api.testnet.1money.network/v1/tokens/update_metadata`

### Transactions

#### `transactions.getByHash(hash)`

Returns transaction details for the specified hash.

**API Endpoint:** `https://api.testnet.1money.network/v1/transactions/by_hash?hash={hash}`

#### `transactions.getReceiptByHash(hash)`

Returns transaction receipt for the specified hash.

**API Endpoint:** `https://api.testnet.1money.network/v1/transactions/receipt/by_hash?hash={hash}`

#### `transactions.estimateFee(from, to, value, token)`

Estimates transaction fee.

**API Endpoint:** `https://api.testnet.1money.network/v1/transactions/estimate_fee?from={from}&value={value}&to={to}&token={token}`

#### `transactions.payment(payload)`

Submits a payment transaction.

**API Endpoint:** `https://api.testnet.1money.network/v1/transactions/payment`

**Payload Structure:**

```typescript
{
  chain_id: number;       // Chain ID (1 for testnet)
  nonce: number;          // Current nonce for the sender account
  recipient: string;      // Recipient address
  value: string;          // Amount to send (as a string)
  token: string;          // Token address
  signature: {            // Transaction signature
    r: string;            // r component of the signature
    s: string;            // s component of the signature
    v: number;            // v component of the signature
  }
}
```

**Example Response:**

```json
{
  "hash": "0x9e8f1d8e9c3d2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c"
}
```

**Example Usage:**

Here's a simplified example of creating and submitting a payment transaction using ethers.js for signing:

```typescript
// Import required libraries
const { api, CHAIN_IDS } = require('@1money/protocol-ts-sdk/api');
const ethers = require('ethers');

// Initialize API client
const apiClient = api();

// Create a wallet from private key
const wallet = new ethers.Wallet('0x...');
const senderAddress = wallet.address;

// Get the current nonce
const nonceResponse = await new Promise((resolve, reject) => {
  apiClient.accounts.getNonce(senderAddress)
    .success(response => resolve(response))
    .error(err => reject(err));
});
const nonce = nonceResponse.nonce;

// Create transaction payload
const transactionPayload = {
  chain_id: CHAIN_IDS.TESTNET, // Testnet chain ID from the SDK
  nonce: nonce,
  recipient: '0xRecipientAddress',
  value: '1000000000',
  token: '0xTokenAddress'
};

// Define the payment payload interface
interface PaymentPayload {
  chainID: number;       // Chain ID (e.g., 1212101 for testnet)
  nonce: number;         // Account nonce
  recipient: string;     // Recipient address
  value: BigNumberish;   // Transaction value
  token: string;         // Token address
  signature?: {          // Optional signature object
    r: string;           // Signature r component
    s: string;           // Signature s component
    v: number;           // Signature v component
  };
}

// Create the payment payload for signing
const payloadToSign: PaymentPayload = {
  chainID: transactionPayload.chain_id,
  nonce: nonce,
  recipient: transactionPayload.recipient,
  value: transactionPayload.value,
  token: transactionPayload.token
};

// Sign the payload using the signMessage function
async function signMessage(payload: PaymentPayload, privateKey: string) {
  // Convert values to appropriate formats for RLP encoding
  const chainIdHex = ethers.toBeHex(payload.chainID);
  const nonceHex = ethers.toBeHex(payload.nonce);
  const valueHex = ethers.toBeHex(payload.value);

  // Create an array of values to encode with RLP
  const rlpData = [chainIdHex, nonceHex, payload.recipient, valueHex, payload.token];

  // RLP encode the data (similar to Go's rlp.EncodeToBytes)
  const encoded = ethers.encodeRlp(rlpData);

  // Hash the RLP encoded data
  const messageHash = ethers.keccak256(encoded);

  // Rest of the signing process...
}

// Call the signMessage function to sign the payload
const signature = await signMessage(payloadToSign, privateKey);

// The signMessage function handles all the details of:
// 1. RLP encoding the payload fields
// 2. Hashing the encoded data
// 3. Signing the hash with the private key
// 4. Formatting the signature components

// Create final payload with signature
const paymentPayload = {
  ...transactionPayload,
  signature: {
    r: sig.r,
    s: sig.s,
    v: sig.v
  }
};

// Submit the transaction
apiClient.transactions.payment(paymentPayload)
  .success(response => {
    console.log('Transaction hash:', response.hash);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

For a complete example with error handling and additional features, see the `examples/payment-transaction.js` file.

#### `transactions.cancel(payload)`

Cancels a transaction.

**API Endpoint:** `https://api.testnet.1money.network/v1/transactions/cancellation`

### Checkpoints

#### `checkpoints.getNumber()`

Returns the current checkpoint number.

**API Endpoint:** `https://api.testnet.1money.network/v1/checkpoints/number`

**Example Response:**

```json
{
  "number": 147411
}
```

#### `checkpoints.getByHash(hash, full)`

Returns checkpoint details for the specified hash.

**API Endpoint:** `https://api.testnet.1money.network/v1/checkpoints/by_hash?hash={hash}&full={full}`

#### `checkpoints.getByNumber(number, full)`

Returns checkpoint details for the specified number.

**API Endpoint:** `https://api.testnet.1money.network/v1/checkpoints/by_number?number={number}&full={full}`

## Testing

The API includes tests that verify the structure and behavior of the API client. The tests make real API calls to the remote endpoint to ensure the API is working correctly. To run the tests, use:

```bash
npm test
```

This will run all tests, including the API tests that make real API calls.

### Example

There's also an example test that demonstrates how to use the API:

```bash
npx mocha --config .mocharc.js src/api/checkpoints/__test__/example.test.ts
```

This will fetch and display the current checkpoint number from the API.
