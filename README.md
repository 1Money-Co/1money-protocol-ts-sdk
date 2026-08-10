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
import { setInitConfig } from '@1money/protocol-ts-sdk/client';

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

**Reads return a chainable promise-like wrapper; v2 writes return a plain promise.**
Every read (`apiClient.<module>.get*`, `apiClient.<module>.estimateFee`, etc.) and
every `legacyV1.*` write returns a promise-like object with `.success()`,
`.timeout()`, `.error()` and `.rest()` handlers, shown below. The **native v2**
write methods (`apiClient.tokens.issueToken`, `apiClient.transactions.payment`,
and the rest of the `TransactionBuilder` → `authorize` → submit pipeline) are
plain `async` functions and return a native `Promise` — `await` them in a
`try/catch` instead of chaining `.success()/.error()`; see the write examples
under [API Methods](#api-methods) below.

For the chainable wrapper, always implement both handlers for proper error management:

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

Every write below follows the same **native v2** shape: `prepare` → sign the
digest → `authorize` → submit the resulting `AuthorizedTxV2`. See
[Migrating from 2.x to 3.0](#migrating-from-2x-to-30) and
`skills/1money-protocol-sdk/references/transactions.md` for the full pipeline,
every builder's fields, and the legacy `LegacyV1TransactionBuilder` /
`api().<module>.legacyV1.*` path.

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

#### Create a Multisig Account
`createMultisig` is **v2-only** — there is no `legacyV1` form and no
`accounts.legacyV1` namespace.

```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner,
  deriveMultisigAddress
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const creatorAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// 33-byte SEC1-compressed public keys. 2-20 signers; a weight is a u8
// (1-255) and the threshold must not exceed the total signer weight.
const signers = [
  { public_key: '0x02...', weight: 1 },
  { public_key: '0x03...', weight: 1 }
];
const threshold = 2;

// The node never echoes the new account's address, so compute it first --
// this is the same value the node derives at execution.
const multisigAddress = deriveMultisigAddress(signers, threshold);

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(creatorAddress);

const prepared = TransactionBuilder.createMultisig({
  chain_id,
  nonce,
  signers,
  threshold
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.accounts.createMultisig(authorized);
  console.log('Multisig', multisigAddress, 'created in tx', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```
See [Derive a multisig account address](#derive-a-multisig-account-address) for
the derivation on its own.

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
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const masterAuthority = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(masterAuthority);

// Prepare (validates fields, computes the digest to sign).
const prepared = TransactionBuilder.tokenIssue({
  chain_id,
  nonce,
  symbol: 'MTK',
  name: 'My Token',
  decimals: 18,
  master_authority: masterAuthority,
  is_private: true,
  clawback_enabled: true
});

// Sign the digest, then authorize it into a plain-JSON request.
const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: submitAuthorized returns a plain Promise, not the chainable
// wrapper -- await it in a try/catch.
try {
  const response = await apiClient.tokens.issueToken(authorized);
  console.log('Token issued:', response.token, 'in tx', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

#### Mint Tokens
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const mintAuthority = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(mintAuthority);

const prepared = TransactionBuilder.tokenMint({
  chain_id,
  nonce,
  recipient: '0xa128999be299373d7881f4add11510030ad13512',
  value: '1000000000000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.mintToken(authorized);
  console.log('Mint transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```
The signer must be the token's `master_authority` or hold a granted mint
authority — see [Grant Token Authority](#grant-token-authority). A granted
authority mints against a finite allowance, which each mint decrements; the
master authority is not metered.

#### Manage Token Blacklist/Whitelist
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';
import { ManageListAction } from '@1money/protocol-ts-sdk/api';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const operatorAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(operatorAddress);

// tokenBlacklist and tokenWhitelist are distinct v2 operations (distinct
// signing hashes) — build the one you intend to submit, they are not
// interchangeable the way the pre-3.0 tokenManageList builder was.
const prepared = TransactionBuilder.tokenBlacklist({
  chain_id,
  nonce,
  action: ManageListAction.Add,
  address: operatorAddress,
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.manageBlacklist(authorized);
  console.log('Blacklist update transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

The whitelist is the same shape end to end — swap both the builder and the
submit method, and sign the one you actually intend to submit:

```typescript
const prepared = TransactionBuilder.tokenWhitelist({
  chain_id,
  nonce,
  action: ManageListAction.Add,
  address: '0xa128999be299373d7881f4add11510030ad13512',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const response = await apiClient.tokens.manageWhitelist(prepared.authorize(signature));
```

Whitelists apply to tokens issued with `is_private: true`. Use
`ManageListAction.Remove` to take an address off either list.

#### Burn Tokens
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const ownerAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(ownerAddress);

const prepared = TransactionBuilder.tokenBurn({
  chain_id,
  nonce,
  value: '1000000000000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.burnToken(authorized);
  console.log('Burn transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

#### Claw Back Tokens
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const clawbackAuthority = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(clawbackAuthority);

const prepared = TransactionBuilder.tokenClawback({
  chain_id,
  nonce,
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  from: '0xa128999be299373d7881f4add11510030ad13512',
  recipient: clawbackAuthority,
  value: '1000000000000000000'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.clawbackToken(authorized);
  console.log('Clawback transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```
Clawback moves tokens out of `from` without that account's signature, so it
only works on a token issued with `clawback_enabled: true` (the default), and
the signer must be the token's `master_authority` or hold a granted
`AuthorityType.Clawback` authority.

#### Grant Token Authority
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';
import { AuthorityAction, AuthorityType } from '@1money/protocol-ts-sdk/api';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const masterAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(masterAddress);

const prepared = TransactionBuilder.tokenAuthority({
  chain_id,
  nonce,
  action: AuthorityAction.Grant,
  authority_type: AuthorityType.MasterMint,
  authority_address: '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  value: '1000000000000000000000'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.grantAuthority(authorized);
  console.log('Authority update transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

#### Pause / Unpause a Token
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';
import { PauseAction } from '@1money/protocol-ts-sdk/api';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const pauseAuthority = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(pauseAuthority);

const prepared = TransactionBuilder.tokenPause({
  chain_id,
  nonce,
  action: PauseAction.Pause, // PauseAction.Unpause to lift it
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.pauseToken(authorized);
  console.log('Pause transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

#### Update Token Metadata
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const metadataAuthority = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(metadataAuthority);

const prepared = TransactionBuilder.tokenMetadata({
  chain_id,
  nonce,
  name: 'My Token',
  uri: 'https://example.com/my-token.json',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  additional_metadata: [{ key: 'category', value: 'stablecoin' }]
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.updateMetadata(authorized);
  console.log('Metadata transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```
`additional_metadata` replaces the whole list rather than merging into it —
send every pair you want to keep. Pass `[]` to clear it.

#### Bridge and Mint
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const bridgeOperatorAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(bridgeOperatorAddress);

const prepared = TransactionBuilder.tokenBridgeAndMint({
  chain_id,
  nonce,
  recipient: '0x6324dAc598f9B637824978eD6b268C896E0c40E0',
  value: '25000000000000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  source_chain_id: 1,
  source_tx_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  bridge_metadata: 'bridge_from_chain_1'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.bridgeAndMint(authorized);
  console.log('Bridge and mint transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

#### Burn and Bridge
```typescript
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const senderAddress = '0x6324dAc598f9B637824978eD6b268C896E0c40E0';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(senderAddress);

const prepared = TransactionBuilder.tokenBurnAndBridge({
  chain_id,
  nonce,
  sender: senderAddress,
  value: '20000000000000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F',
  destination_chain_id: 1,
  destination_address: '0x1234567890abcdef1234567890abcdef12345678',
  escrow_fee: '1000000000000000000',
  bridge_metadata: 'bridge_to_chain_1',
  bridge_param: '0x'
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.tokens.burnAndBridge(authorized);
  console.log('Burn and bridge transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
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
import {
  TransactionBuilder,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const senderAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

// Get chain id and current nonce
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(senderAddress);

// Prepare (validates fields, computes the digest to sign). `memo` is always
// sent on the wire; omit the option for the all-empty "no business memo".
const prepared = TransactionBuilder.payment({
  chain_id,
  nonce,
  recipient: '0xa128999be299373d7881f4add11510030ad13512',
  value: '1000000000',
  token: '0x2cd8999Be299373D7881f4aDD11510030ad1412F'
});

// Sign the digest, then authorize it into a plain-JSON request.
const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature); // signature.v must be 0 or 1

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.transactions.payment(authorized);
  console.log('Payment transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

#### Submit Batch Payment
Pay many recipients of one token in one canonical native-v2 transaction.
`batchPayment` is **v2-only**: the SDK deliberately exposes no legacy Batch
Payment builder or `transactions.legacyV1.batchPayment`, even if a node still
retains a deprecated v1 route.

```typescript
import {
  TransactionBuilder,
  calculateBatchPaymentOperationsHash,
  createPrivateKeySigner
} from '@1money/protocol-ts-sdk';

// Your private key (DO NOT share or commit your private key)
const privateKey = process.env.ONE_MONEY_PRIVATE_KEY as `0x${string}`;
const senderAddress = '0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC74ff3';

const token = '0x2cd8999Be299373D7881f4aDD11510030ad1412F';
const operations = [
  { recipient: '0xa128999be299373d7881f4add11510030ad13512', amount: '1000000000' },
  { recipient: '0x6324dAc598f9B637824978eD6b268C896E0c40E0', amount: '2000000000' }
];

// An unsigned, non-binding point-in-time quote. It is not a fee cap and is
// not copied into the payload, signing hash, authorization, or submission.
const quote = await apiClient.transactions.estimateBatchPaymentFee({
  from: senderAddress,
  token,
  operations
});
console.log('Estimated fee:', quote.fee, 'plan:', quote.plan);

// Get chain id and a fresh current nonce.
const { chain_id } = await apiClient.chain.getChainId();
const { nonce } = await apiClient.accounts.getNonce(senderAddress);

// This optional field is a caller choice. If supplied, the builder recomputes
// it and rejects a mismatch locally before any signer is invoked.
const operationsHash = calculateBatchPaymentOperationsHash(operations);

const prepared = TransactionBuilder.batchPayment({
  chain_id,
  nonce,
  token,
  operations,
  created_at: Math.floor(Date.now() / 1000), // unix seconds
  operations_hash: operationsHash,
  batch_id: 'payroll-2026-08'
}, {
  memo: {
    type: 'purpose/SALA',
    format: 'text/plain',
    data: 'payroll-2026-08'
  }
});

const signature = await createPrivateKeySigner(privateKey).signDigest(prepared.signingHash);
const authorized = prepared.authorize(signature);

// v2 write: returns a plain Promise -- await it in a try/catch.
try {
  const response = await apiClient.transactions.batchPayment(authorized);
  // The SDK already checks this case-insensitively before resolving.
  if (
    response.hash.toLowerCase() !==
    authorized.transactionHash.toLowerCase()
  ) {
    throw new Error('SDK already rejects a server/local hash mismatch');
  }
  console.log('Batch payment transaction hash:', response.hash);
} catch (err) {
  console.error('Error:', err);
}
```

`operations` must not be empty; each recipient and amount must be nonzero, and
the aggregate cannot exceed U256::MAX. `operations_hash` is optional, but a
provided value must be the canonical
`calculateBatchPaymentOperationsHash(operations)` result or preparation fails
locally. `batch_id` is signed correlation metadata only: it has no uniqueness,
deduplication, idempotency, or replay guarantee. The transaction nonce remains
the transaction-level replay mechanism. Each operation is signed and sent as
exactly `{ recipient, amount }`; additional runtime properties from untyped
callers are ignored and do not reach the authorized request.

Batch Payment always signs and transmits a complete memo. Omitting `memo` is
valid and sends `{ type: '', format: '', data: '' }`; those three empty strings
are still part of the signed payload. The obsolete client-side `max_fee` field
is not accepted. The actual sender debit is the sum of all operation amounts
plus the receipt's actual string `fee_used`, not the estimate. Batch enablement,
operation-count and encoded-size limits, and the fee asset are dynamic node
governance rules, so a successful estimate is not an admission guarantee.

After the returned hash is indexed, read its receipt (or finalized receipt) and
use `execution_events` to inspect the recipients:

```typescript
const receipt = await apiClient.transactions.getReceiptByHash(
  authorized.transactionHash
);

// Batch Payment has no single recipient. This zero address is a sentinel.
console.log(receipt.success_info?.receiver);

for (const event of receipt.execution_events ?? []) {
  if (event.event_type === 'PaymentExecuted') {
    console.log(event.recipient, event.amount);
  }
}

console.log('actual fee:', receipt.fee_used);
```

For a Batch Payment, `success_info.receiver` is the zero-address sentinel, not
a transfer destination; real recipients and amounts are the ordered
`PaymentExecuted` events. `batch_info.failure` is reserved for forward
compatibility but is `null` in current production-shaped responses and is not a
terminal-failure signal. If any operation fails, the node rolls back every
recipient credit, the sender debit, and operator-fee movement together; do not
infer a non-null failure object from that rule.

To verify an intentional rollback scenario, do not rely on a receipt or an
error body as a terminal signal: failure can be receipt-less or ambiguous, and
`batch_info.failure` remains `null` in current behavior. Before submission,
snapshot balances for the sender, every planned recipient, and the operator fee
recipient. Submit once, make only a bounded observation of the submission and
ordinary/finalized receipt paths, then verify every snapshot is unchanged. Use
an isolated sender so any uncertain nonce or mempool state cannot affect other
transactions.


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
const boolHex = toHex(true); // '0x1' (minimal hex, not zero-padded)
const numHex = toHex(123); // '0x7b'
const strHex = toHex('hello'); // '0x68656c6c6f'
const arrHex = toHex([1, 2, 3]); // '0x010203'
```

### Derive a multisig account address
Compute the address a native multisig account will get *before* creating it —
`accounts.createMultisig` only returns `{ hash }`, never the address:

```typescript
import { deriveMultisigAddress } from '@1money/protocol-ts-sdk';

const address = deriveMultisigAddress(
  [
    { public_key: '0x02...', weight: 1 },
    { public_key: '0x03...', weight: 1 },
  ],
  2 // threshold
); // → '0x…'
```

### Sign Message (deprecated)
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
`signMessage` and `encodePayload` are legacy `@deprecated` helpers. Prefer
`TransactionBuilder` (or `LegacyV1TransactionBuilder` during a migration
window) for new code — see [Migrating from 2.x to 3.0](#migrating-from-2x-to-30).

## Migrating from 2.x to 3.0

3.0 makes the domain-separated **native v2** signing scheme the default and
moves the pre-3.0 scheme behind an explicit namespace. This is a breaking
change for any code calling `TransactionBuilder` directly.

- **`TransactionBuilder` now means v2.** `TransactionBuilder.payment(...)` (and
  every other operation) returns a `PreparedTxV2`, not the old `PreparedTx`.
  It no longer has `.sign()` / `.attachSignature()` / `.rlpBytes` /
  `.signatureHash`; it has `.signingHash` and `.authorize(signature)` instead.
- **The pre-3.0 scheme still exists**, unchanged, as
  `LegacyV1TransactionBuilder` (same builder names, same `.sign()`/
  `.attachSignature()`/`.toRequest()` shape as before) paired with
  `api().<module>.legacyV1.*` submit methods (e.g.
  `client.transactions.legacyV1.payment(...)`,
  `client.tokens.legacyV1.manageBlacklist(...)`). `accounts` has no
  `legacyV1` namespace, and `batchPayment` / `createMultisig` have no legacy
  form at all — both are v2-only.
- **Write methods now take an `AuthorizedTxV2`**, the output of
  `prepared.authorize(signature)`, instead of a request object assembled from
  `signed.toRequest()`. `AuthorizedTxV2` is plain JSON and can cross a process
  boundary (sign in one place, submit from another). Each call to `authorize`
  returns an independent request snapshot; mutating an earlier request,
  including its memo, cannot affect a later authorization or its hashes.
- **Write methods now return a native `Promise`, not the chainable wrapper.**
  This is the easy one to miss, because **reads are unchanged** — the same
  client now has two call styles:

  ```typescript
  // Read: still the promise wrapper.
  apiClient.tokens.getTokenMetadata(token).success(res => …).error(err => …);

  // Write: a plain Promise. Calling .success() on it throws
  // "apiClient.tokens.issueToken(...).success is not a function".
  try {
    const res = await apiClient.tokens.issueToken(authorized);
  } catch (err) { … }
  ```

  So `.success()`/`.error()`/`.timeout()`/`.rest()` chains on any 2.x **write**
  call must become `await` in a `try`/`catch`. TypeScript flags these at
  compile time; plain-JavaScript callers only find out at runtime.
- **`tokenManageList` is gone.** It split into `tokenBlacklist` and
  `tokenWhitelist` — distinct operations with distinct signing hashes, paired
  with `tokens.manageBlacklist` / `tokens.manageWhitelist` respectively. You
  can no longer build one payload and submit it to either endpoint.
- **`memo` is now always sent** on the v2 surface. Every operation carries a
  memo on the wire; omitting the `memo` option sends the all-empty
  `{ type: '', format: '', data: '' }` rather than leaving the field off
  entirely. This differs from the pre-3.0 behavior, where an absent memo took
  a different code path from a present one.
- **Batch Payment uses the canonical v2 payload.** The removed `max_fee` field
  is neither signed nor accepted; request an unsigned
  `transactions.estimateBatchPaymentFee({ from, token, operations })` quote
  instead. The shared `EstimateFee` response now has `fee: string` and optional
  `plan?: string`, so this also applies to the existing `estimateFee()` call.
- **Receipt fields are corrected for all callers.** `TransactionReceipt.fee_used`
  is a decimal string (not a number), and `to` is renamed to `recipient`.
  `FinalizedTransactionReceipt` extends this corrected common receipt shape,
  so finalized-read callers must make the same updates.
- **Signature `v` must be `0` or `1`** on the v2 surface; a legacy `27`/`28` is
  rejected by `authorize`, not converted.

There is no published sunset date for the legacy `/v1` write surface or for
`LegacyV1TransactionBuilder` — the node does not advertise one, and operators
run the cutover on their own schedule. Check
`client.status.getNativeWriteStatus()` to see which surface is currently live
before depending on either one.

See `skills/1money-protocol-sdk/references/transactions.md` for the full v2
pipeline and every builder's fields, and
`skills/1money-protocol-sdk/references/client-and-errors.md` for the new v2
error codes and `TransactionHashMismatchError`.

## License
MIT
