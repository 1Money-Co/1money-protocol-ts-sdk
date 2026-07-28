# API reference — read endpoints & response shapes

Every method below returns the SDK promise wrapper (see
`client-and-errors.md`). The value handed to `.success(cb)` / resolved by
`await` is the **decoded response body directly** — the shapes shown here are
exactly what you get.

All addresses, hashes, and large numbers are hex/decimal **strings**. `U256`
amounts are decimal strings (base units); `B256`/address values are `0x…` hex.

## Table of contents
- [Client construction](#client-construction)
- [chain](#chain)
- [accounts](#accounts)
- [tokens (read)](#tokens-read)
- [transactions (read)](#transactions-read)
- [checkpoints](#checkpoints)
- [status](#status)
- [Write endpoints (index)](#write-endpoints-index)
- [Constants](#constants)

## Client construction

```typescript
import { api } from '@1money/protocol-ts-sdk';

const client = api(options?: {
  network?: 'testnet' | 'mainnet' | 'local'; // default 'mainnet'
  timeout?: number;                           // ms, default 10000
});
// → { accounts, checkpoints, tokens, transactions, chain, status }
```

**Reads stay on `/v1`.** Every read method below (and every method in this
file except the `status` endpoints, which sit outside any `/v1`/`/v2` prefix)
hits the node's `/v1` REST surface regardless of whether native writes are on
v1, v2, or both. `/v2` is a **write-only** surface — there is no `/v2` read
endpoint to switch to. See `references/transactions.md` for the write side.

Base URLs by network: mainnet `https://api.1money.network`, testnet
`https://api.testnet.1money.network`, local `http://localhost:18555`.

## chain

```typescript
client.chain.getChainId() // → { chain_id: number }
```

## accounts

```typescript
client.accounts.getNonce(address: string)
// → { nonce: number }                  next nonce to use for this sender

client.accounts.getBbNonce(address: string)
// → { bbnonce: number }

client.accounts.getTokenAccount(address: string, token: string)
// → { balance: string /* U256 base units */, nonce: number }
```

`getTokenAccount` is how you read a wallet's balance of a specific token. To
compute the associated token-account address offline, use `deriveTokenAddress`
(see `client-and-errors.md` → Utilities).

## tokens (read)

```typescript
client.tokens.getTokenMetadata(token: string) // → MintInfo
```

`MintInfo` (token-wide config and authorities):

```typescript
interface MintInfo {
  symbol: string;
  master_authority: string;
  master_mint_burn_authority: string;
  mint_burn_authorities: { minter: string; allowance: string }[];
  pause_authorities: string[];
  list_authorities: string[];
  black_list: string[];
  white_list: string[];
  metadata_update_authorities: string[];
  bridge_mint_authorities: string[];
  supply: string;          // U256 base units
  decimals: number;
  is_paused: boolean;
  is_private: boolean;
  clawback_enabled: boolean;
  meta: {
    name: string;
    uri: string;
    additional_metadata: { key: string; value: string }[];
  };
}
```

## transactions (read)

```typescript
client.transactions.getByHash(hash: string)          // → Transaction
client.transactions.getReceiptByHash(hash: string)   // → TransactionReceipt
client.transactions.getFinalizedByHash(hash: string) // → FinalizedTransactionReceipt
client.transactions.estimateFee(from, to, value, token) // → { fee: string }
```

`estimateFee(from: string, to: string, value: string, token: string)` — note the
argument order is **from, to, value, token** (value before to in the URL, but the
function signature is from/to/value/token).

`TransactionReceipt`:

```typescript
interface TransactionReceipt {
  success: boolean;            // did the tx succeed on-chain
  transaction_hash: string;
  fee_used: number;
  from: string;
  checkpoint_hash?: string;
  checkpoint_number?: number;
  to?: string;
  token_address?: string;
}
// FinalizedTransactionReceipt extends it with:
//   epoch: number; counter_signatures: { r; s; v }[]
```

`Transaction` is a **discriminated union** keyed by `transaction_type`
(`'TokenCreate' | 'TokenTransfer' | 'TokenMint' | 'TokenGrantAuthority' |
'TokenRevokeAuthority' | 'TokenBlacklistAccount' | 'TokenWhitelistAccount' |
'TokenBridgeAndMint' | 'TokenBurn' | 'TokenBurnAndBridge' | 'TokenClawback' |
'TokenCloseAccount' | 'TokenPause' | 'TokenUnpause' | 'TokenUpdateMetadata' |
'Raw'`). All variants share `hash`, `chain_id`, `from`, `nonce`, `signature`,
plus optional `checkpoint_*`/`transaction_index` and an optional `memo` (present
only for V2/memo-bearing txs); each carries a `data` object specific to its type.
Narrow on `transaction_type` before reading `data`.

## checkpoints

(1Money's term for blocks.)

```typescript
client.checkpoints.getNumber()                    // → { number: number }
client.checkpoints.getByHash(hash, full = false)  // → Checkpoint
client.checkpoints.getByNumber(number, full = false) // number: number | string → Checkpoint
client.checkpoints.getReceiptsByNumber(number: number | string) // → TransactionReceipt[]
```

`full` controls whether `transactions` comes back as full `Transaction[]`
(`true`) or just an array of hashes (`false`, default).

```typescript
interface Checkpoint {
  hash: string; parent_hash: string;
  state_root: string; transactions_root: string; receipts_root: string;
  number: number; timestamp: number;
  size?: number;
  transactions: Transaction[] | string[]; // hashes unless full=true
}
```

## status

Operational status endpoints. Not under the `/v1` (or `/v2`) prefix at all.

```typescript
client.status.getNativeWriteStatus()
// → GET /api/status
// → {
//     native_write_mode: 'v1_only' | 'dual' | 'v2_only';
//     read_only: boolean;              // true on an archive/read-only profile
//     activation_source: 'not_activated' | 'capability_full' | 'binary_release';
//     dual_activated_at_secs: number | null;
//     native_domain_separated_transactions: {
//       support_count: number; required_count: number; full_support: boolean;
//     };
//   }

client.status.getHealth()
// → GET /api/health — plain-text body (e.g. "UP"), not JSON.
```

Check `getNativeWriteStatus()` before switching between the v2 and `legacyV1`
surfaces — never probe by submitting under the other scheme, because a retry
under a different signing scheme is a *new* signed transaction, not a retry
of the same one, and can create a second transaction on the same nonce. The
capability counts are a recent observation, not an instantaneous one: a
validator that stops broadcasting can still be counted for roughly 150
seconds.

## Write endpoints (index)

These take an **`AuthorizedTxV2`** built via `TransactionBuilder.<op>(...)
.authorize(sig)` — see `transactions.md`. All fourteen native v2 operations,
listed here only so you pick the right one:

```typescript
client.transactions.payment(authorized)        // POST /v2/transactions/payment        → { hash }
client.transactions.batchPayment(authorized)   // POST /v2/transactions/batch_payment   → { hash }
client.tokens.issueToken(authorized)           // POST /v2/tokens/issue                 → { hash, token }
client.tokens.mintToken(authorized)            // POST /v2/tokens/mint                  → { hash }
client.tokens.burnToken(authorized)            // POST /v2/tokens/burn                  → { hash }
client.tokens.grantAuthority(authorized)       // POST /v2/tokens/grant_authority       → { hash }
client.tokens.manageBlacklist(authorized)      // POST /v2/tokens/manage_blacklist      → { hash }
client.tokens.manageWhitelist(authorized)      // POST /v2/tokens/manage_whitelist      → { hash }
client.tokens.pauseToken(authorized)           // POST /v2/tokens/pause                 → { hash }
client.tokens.updateMetadata(authorized)       // POST /v2/tokens/update_metadata       → { hash }
client.tokens.bridgeAndMint(authorized)        // POST /v2/tokens/bridge_and_mint       → { hash }
client.tokens.burnAndBridge(authorized)        // POST /v2/tokens/burn_and_bridge       → { hash }
client.tokens.clawbackToken(authorized)        // POST /v2/tokens/clawback              → { hash }
client.accounts.createMultisig(authorized)     // POST /v2/accounts/multisig            → { hash }
```

Each of the above (except `batchPayment` and `createMultisig`, which are
v2-only) has a `legacyV1` counterpart that takes the old signed-payload shape
directly and posts to the matching `/v1` path, e.g.
`client.transactions.legacyV1.payment(payload)` →
`POST /v1/transactions/payment`, `client.tokens.legacyV1.manageBlacklist(payload)`
→ `POST /v1/tokens/manage_blacklist`. `accounts` has no `legacyV1` namespace.

`POST /v1/transactions/raw` — the endpoint legacy clients used for
account-type operations like multisig creation — is **retired**: it returns
410 on every node. There is no v1 replacement; use `accounts.createMultisig`.

## Constants

The chain ids are defined internally as `CHAIN_IDS` (mainnet `21210`, testnet
`1212101`, local `1212101`) but are **not re-exported** from any public entry
point (`.`, `/api`, `/client`, `/utils`). Don't try to import them — fetch the
live value at runtime:

```typescript
const { chain_id } = await client.chain.getChainId();
```

If you genuinely need a hardcoded id for an offline/test path, define your own
constant rather than relying on an unexported one.
