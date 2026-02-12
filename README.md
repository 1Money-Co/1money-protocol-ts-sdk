# @1money/protocol-ts-sdk
<img src="./public/logo.png" alt="1Money Logo" width="200"/> 

The TS-SDK for 1Money Network Protocol

[![Build Status](https://github.com/1Money-Co/1money-protocol-ts-sdk/actions/workflows/cicd-npm.yml/badge.svg)](https://github.com/1Money-Co/1money-protocol-ts-sdk/actions/workflows/cicd-npm.yml)
[![NPM downloads](http://img.shields.io/npm/dm/%401money%2Fprotocol-ts-sdk.svg?style=flat-square)](https://www.npmjs.com/package/@1money/protocol-ts-sdk)
[![npm version](https://badge.fury.io/js/%401money%2Fprotocol-ts-sdk.svg)](https://badge.fury.io/js/%401money%2Fprotocol-ts-sdk)
[![install size](https://packagephobia.now.sh/badge?p=%401money%2Fprotocol-ts-sdk)](https://packagephobia.now.sh/result?p=%401money%2Fprotocol-ts-sdk)
[![license](http://img.shields.io/npm/l/%401money%2Fprotocol-ts-sdk.svg)](https://github.com/1Money-Co/1money-protocol-ts-sdk/blob/main/LICENSE)

## Quick start
### Install
```shell
npm i -S @1money/protocol-ts-sdk axios viem @ethereumjs/rlp
# or
yarn add @1money/protocol-ts-sdk axios viem @ethereumjs/rlp
# or
pnpm i @1money/protocol-ts-sdk axios viem @ethereumjs/rlp
```

### Initialize the API Client

```typescript
import { api } from '@1money/protocol-ts-sdk';

// Initialize with default settings (mainnet)
const apiClient = api();

// Or specify testnet network
const testnetClient = api({ network: 'testnet' });

// You can also set a custom timeout (in milliseconds)
const apiClient = api({
  network: 'testnet',
  timeout: 5000 // 5 seconds
});
```

### Configure Custom HTTP Headers

You can set custom HTTP headers that will be included in all API requests:

```typescript
import { setInitConfig } from '@1money/protocol-ts-sdk';

// Set custom headers for all requests
setInitConfig({
  headers: {
    'Authorization': 'Bearer your-token',
    'X-Custom-Header': 'custom-value'
  }
});

// You can also combine with other configuration options
setInitConfig({
  baseURL: 'https://api.custom-domain.com',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer your-token',
    'X-API-Key': 'your-api-key'
  }
});
```

**Note**: Custom headers are automatically merged with axios default headers, ensuring both your custom headers and the library's default security headers are included in all requests.

### Fetch the current checkpoint number

```typescript
const number = await apiClient.checkpoints.getNumber()
  .success(response => {
    console.log('number', response.number);
    return response.number;
  })
  .error(err => {
    console.error('Error:', err);
    // return a default value
    return 0;
  });

// do something with the number
// ...
```

### Get checkpoint by number
```typescript
const checkpoint = await apiClient.checkpoints.getByNumber(1)
  .success(response => {
    console.log('checkpoint', response);
  });
```

## CDN
```html
<script src="https://unpkg.com/@1money/protocol-ts-sdk@latest/umd/1money-protocol-ts-sdk.min.js"></script>

<script>
  const apiClient = window.$1money.api({
    network: 'testnet'
  });

  async function getNumber () {
    const res = await apiClient.checkpoints.getNumber();
    console.log('res: ', res);
  }

  getNumber();
</script>
```

## Error Handling

All API methods return a promise-like object with `.success()`, `.timeout()`, `.error()` and `.rest()` handlers. Always implement both handlers for proper error management:

1. `.success()`: Handles successful API responses
2. `.timeout()`: Specifically handles timeout errors
3. `.error()`: Handles all other types of errors
4. `.rest()`: A final handler that runs after any of the above handlers complete

```typescript
import { api } from '@1money/protocol-ts-sdk';

const apiClient = api();

apiClient.someMethod()
  .success(response => {
    // Handle successful response
  })
  .timeout(err => {
    // Handle timeout case
  })
  .error(err => {
    // Handle other errors
  });
```

You can use `rest` to handle all other errors:
```typescript
apiClient.someMethod()
  .success(response => {
    // Handle successful response
  })
  .rest(err => {
    // Handle other cases
  });
```

#### Async/Await
You also can use async/await to handle the response:
```typescript
import { api } from '@1money/protocol-ts-sdk';

const apiClient = api();

try {
  const response = await apiClient.someMethod();
  console.log('Response:', response);
} catch (err) {
  console.error('Error:', err);
}
``` 

#### Promise
You also can use standard `promise` to handle the response:
```typescript
import { api } from '@1money/protocol-ts-sdk';

const apiClient = api();

apiClient.someMethod()
  .then(response => {
    console.log('Response:', response);
  })
  .catch(err => {
    console.error('Error:', err);
  });
```

## API Methods

### Chain API

#### Get Chain ID
```typescript
apiClient.chain.getChainId()
  .success(response => {
    console.log('Current chain id:', response.chain_id);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

### Accounts API

#### Get Account Nonce
```typescript
const address = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
apiClient.accounts.getNonce(address)
  .success(response => {
    console.log('Account nonce:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Get Associated Token Account
```typescript
const address = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
const token = '0x2cd8999Be299373D7881f4aDD11510030ad1412F';
apiClient.accounts.getTokenAccount(address, token)
  .success(response => {
    console.log('Associated token account:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

### Tokens API

#### Get Token Metadata
```typescript
const tokenAddress = '0x2cd8999Be299373D7881f4aDD11510030ad1412F';
apiClient.tokens.getTokenMetadata(tokenAddress)
  .success(response => {
    console.log('Token metadata:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Issue New Token
```typescript
import { signMessage, toHex } from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = 'YOUR_PRIVATE_KEY';

// First, get the latest epoch checkpoint
const epochData = await apiClient.state.getLatestEpochCheckpoint()
  .success(response => response);

// Create the payload array for signing
const payload = [
  1, // chain_id
  1, // nonce
  'MTK', // symbol
  'My Token', // name
  18, // decimals
  '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3', // master_authority
  true, // is_private
  true, // clawback_enabled
];

// Generate signature
const signature = await signMessage(payload, privateKey);
if (!signature) {
  throw new Error('Failed to generate signature');
}

// Create the issue payload
const issuePayload = {
  chain_id: 1,
  nonce: 1,
  name: 'My Token',
  symbol: 'MTK',
  decimals: 18,
  master_authority: '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3',
  is_private: true,
  clawback_enabled: true,
  signature
};

apiClient.tokens.issueToken(issuePayload)
  .success(response => {
    console.log('Token issued:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Manage Token Blacklist/Whitelist
```typescript
import { signMessage, toHex } from '@1money/protocol-ts-sdk';
import type { ManageListAction } from '@1money/protocol-ts-sdk/api';

// Your private key (DO NOT share or commit your private key)
const privateKey = 'YOUR_PRIVATE_KEY';

// First, get the latest epoch checkpoint
const epochData = await apiClient.state.getLatestEpochCheckpoint()
  .success(response => response);

// Create the payload array for signing
const payload = [
  1, // chain_id
  1, // nonce
  ManageListAction.Add, // action
  '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3', // address
  '0x2cd8999Be299373D7881f4aDD11510030ad1412F', // token
];

// Generate signature
const signature = await signMessage(payload, privateKey);
if (!signature) {
  throw new Error('Failed to generate signature');
}

// Create the manage list payload
const manageListPayload = {
  chain_id: 1,
  nonce: 1,
  action: ManageListAction.Add,
  address: '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  signature
};

// Use manageBlacklist for blacklist operations
apiClient.tokens.manageBlacklist(manageListPayload)
  .success(response => {
    console.log('Blacklist update transaction hash:', response.hash);
  })
  .error(err => {
    console.error('Error:', err);
  });

// Or use manageWhitelist for whitelist operations
apiClient.tokens.manageWhitelist(manageListPayload)
  .success(response => {
    console.log('Whitelist update transaction hash:', response.hash);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Burn Tokens
```typescript
import { signMessage, toHex } from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = 'YOUR_PRIVATE_KEY';

// First, get the latest epoch checkpoint
const epochData = await apiClient.state.getLatestEpochCheckpoint()
  .success(response => response);

// Create the payload array for signing
const payload = [
  1, // chain_id
  1, // nonce
  '1000000000000000000', // amount
  '0x2cd8999Be299373D7881f4aDD11510030ad1412F', // token
];

// Generate signature
const signature = await signMessage(payload, privateKey);
if (!signature) {
  throw new Error('Failed to generate signature');
}

// Create the burn payload
const burnPayload = {
  chain_id: 1,
  nonce: 1,
  value: '1000000000000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  signature
};

apiClient.tokens.burnToken(burnPayload)
  .success(response => {
    console.log('Burn transaction hash:', response.hash);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Grant Token Authority
```typescript
import { signMessage, toHex } from '@1money/protocol-ts-sdk';
import type { AuthorityType, AuthorityAction } from '@1money/protocol-ts-sdk/api';

// Your private key (DO NOT share or commit your private key)
const privateKey = 'YOUR_PRIVATE_KEY';

// First, get the latest epoch checkpoint
const epochData = await apiClient.state.getLatestEpochCheckpoint()
  .success(response => response);

// Create the payload array for signing
const payload = [
  1, // chain_id
  1, // nonce
  AuthorityAction.Grant, // action
  AuthorityType.MasterMint, // authority_type (sends 'MasterMintBurn')
  '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3', // authority_address
  '0x2cd8999Be299373D7881f4aDD11510030ad1412F', // token
  '1000000000000000000000', // value (optional, for MintBurnTokens type)
];

// Generate signature
const signature = await signMessage(payload, privateKey);
if (!signature) {
  throw new Error('Failed to generate signature');
}

// Create the authority payload
const authorityPayload = {
  chain_id: 1,
  nonce: 1,
  action: AuthorityAction.Grant,
  authority_type: AuthorityType.MasterMint, // value is 'MasterMintBurn'
  authority_address: '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  value: '1000000000000000000000',
  signature
};

apiClient.tokens.grantAuthority(authorityPayload)
  .success(response => {
    console.log('Authority update transaction hash:', response.hash);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

### Transactions API

#### Get Transaction Details
```typescript
const txHash = '0xf55f9525be94633b56f954d3252d52b8ef42f5fd5f9491b243708471c15cc40c';
apiClient.transactions.getByHash(txHash)
  .success(response => {
    console.log('Transaction details:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Get Transaction Receipt
```typescript
const txHash = '0xf55f9525be94633b56f954d3252d52b8ef42f5fd5f9491b243708471c15cc40c';
apiClient.transactions.getReceiptByHash(txHash)
  .success(response => {
    console.log('Transaction receipt:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Estimate Transaction Fee
```typescript
const fromAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';
const toAddress = '0x6324dAc598f9B637824978eD6b268C896E0c40E0';
const value = '1000000000';
const tokenAddress = '0x2cd8999Be299373D7881f4aDD11510030ad1412F';

apiClient.transactions.estimateFee(fromAddress, toAddress, value, tokenAddress)
  .success(response => {
    console.log('Estimated fee:', response);
  })
  .error(err => {
    console.error('Error:', err);
  });
```

#### Submit Payment Transaction
```typescript
import { signMessage, toHex } from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = 'YOUR_PRIVATE_KEY';

// First, get the latest epoch checkpoint
const epochData = await apiClient.state.getLatestEpochCheckpoint()
  .success(response => response);

// Create the payload array for signing
const payload = [
  1, // chain_id
  1, // nonce
  '0x2cd8999Be299373D7881f4aDD11510030ad1412F', // recipient
  '1000000000', // value
  '0x2cd8999Be299373D7881f4aDD11510030ad1412F', // token
];

// Generate signature
const signature = await signMessage(payload, privateKey);
if (!signature) {
  throw new Error('Failed to generate signature');
}

// Create the payment payload
const paymentPayload = {
  chain_id: 1,
  nonce: 1,
  recipient: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  value: '1000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  signature
};

apiClient.transactions.payment(paymentPayload)
  .success(response => {
    console.log('Payment transaction hash:', response.hash);
  })
  .error(err => {
    console.error('Error:', err);
  });
```


## Utility Functions

### Calculate Transaction Hash
```typescript
import { calcTxHash } from '@1money/protocol-ts-sdk';

// Create the payload array
const payload = [
  1212101, // chain_id
  2, // nonce
  '0x0000000000000000000000000000000000000000', // recipient
  1024, // value
  '0x0000000000000000000000000000000000000000', // token
];

// Create the signature object
const signature = {
  r: '0xe9ef6ce7aaeb4656f197b63a96c932ab5e0fd2df0913f6af1c8e7b1879e5ed0a',
  s: '0x68a9cbaa35af5e3d896a2841d19a42dba729380a1c91864403de872578f6f6c3',
  v: 0,
};

// Calculate the transaction hash
const hash = calcTxHash(payload, signature);
console.log('Transaction hash:', hash);
```

### Derive Token Address
```typescript
import { deriveTokenAddress } from '@1money/protocol-ts-sdk';

const walletAddress = '0xA634dfba8c7550550817898bC4820cD10888Aac5';
const mintAddress = '0x8E9d1b45293e30EF38564582979195DD16A16E13';

// Derive the token account address
const tokenAddress = deriveTokenAddress(walletAddress, mintAddress);
console.log('Token account address:', tokenAddress);
```

### Convert to Hex
```typescript
import { toHex } from '@1money/protocol-ts-sdk';

// Convert different types to hex
const boolHex = toHex(true); // '0x01'
const numHex = toHex(123); // '0x7b'
const strHex = toHex('hello'); // '0x68656c6c6f'
const arrHex = toHex([1, 2, 3]); // '0x010203'
```

### Sign Message
```typescript
import { signMessage } from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = 'YOUR_PRIVATE_KEY';

// Create the payload array for signing
const payload = [
  1212101, // chain_id
  2, // nonce
  '0x0000000000000000000000000000000000000000', // recipient
  '1000000000000000000', // value (in wei)
  '0x0000000000000000000000000000000000000000', // token
];

// Sign the message
const signature = await signMessage(payload, privateKey);
```

## License
MIT
