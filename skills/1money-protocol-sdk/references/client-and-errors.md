# Client, error handling, config & utilities

## The promise wrapper in depth

Every API method returns an object that is **both** a `Promise` and a builder of
handler chains. You consume it one of two ways.

### Await style

```typescript
try {
  const res = await client.accounts.getNonce(addr); // resolves with the body
  console.log(res.nonce);
} catch (err) {
  // err is a ParsedError (see below) — thrown only when NO error handler chained
}
```

### Chain style

```typescript
client.accounts.getNonce(addr)
  .success(res => res.nonce)   // res is the decoded body, not wrapped
  .timeout(err => { /* fired specifically on configured timeout */ })
  .error(err => { /* any other error */ });
```

Handlers and what they fire on:

| Handler | Fires when |
| --- | --- |
| `.success(cb)` | request succeeded (HTTP 200 by `api()`'s rule) |
| `.failure(cb)` | a 2xx response that fails the success rule (rare — see note) |
| `.error(cb)` | network error, non-2xx HTTP status, or a throw in another handler |
| `.timeout(cb)` | the configured `timeout` elapsed (request is aborted) |
| `.login(cb)` | auth-required responses (HTTP 401 / `code === 401`) |
| `.rest(cb, scope?)` | catch-all for whichever cases you didn't handle |

> `api()` sets the success rule to `status === 200`. Since axios rejects non-2xx
> responses by default, most server-side failures (4xx/5xx) arrive at `.error`,
> not `.failure`. `.failure` only fires for a resolved response that isn't 200
> and isn't a login — uncommon in practice. For consumer code, handling
> `.success` + `.error` (or `try/catch`) covers the real cases.

Important behavioral notes:

- **Return value of the chain.** Awaiting with no handlers returns the raw body
  (e.g. `await client.chain.getChainId()` → `{ chain_id }`) — this is the cleanest
  idiom for the common case. Attaching `.success(cb)` instead makes the awaited
  value equal to `cb`'s return, which is useful when you want to transform or map
  the body inline.
- **Errors resolve vs. throw.** If you attach `.error()` (or `.rest()` covering
  errors), the awaited chain **resolves** with the handler's return instead of
  throwing. With no error handler, `await` **throws**. Don't half-mix: either
  handle errors in the chain, or `try/catch` the await — not an awkward both.
- **`.rest(cb, scope)`** lets you target a subset, e.g. handle only timeout +
  error with one callback: `.rest(cb, ['timeout', 'error'])`. An empty scope, or
  a scope whose cases were all already handled, warns and never fires.

### ParsedError shape

```typescript
interface ParsedError<T extends string = string> {
  name: T;          // 'timeout' for timeouts, else the underlying error name
  message: string;
  stack: string;
  status: number;   // HTTP status, or 500 if none
  data?: any;       // server error body when present
}
```

## Configuration & custom headers

`api()` sets base URL, timeout, and the success rule globally. To add headers
(auth tokens, API keys) or override the base URL, use `setInitConfig` — headers
merge with the SDK's defaults rather than replacing them:

```typescript
// Import from the /client subpath — setInitConfig is NOT a named export of the
// package root (the README's root import is inaccurate). The default `client`
// object from the root also carries it as `client.setInitConfig(...)`.
import { setInitConfig } from '@1money/protocol-ts-sdk/client';

setInitConfig({
  headers: { Authorization: 'Bearer <token>', 'X-API-Key': '<key>' },
  // optional:
  baseURL: 'https://api.custom-domain.com',
  timeout: 10000,
});
```

> Config is **global/singleton** — it applies to all module references obtained
> from `api()`. Call `setInitConfig` once at startup (after `api()`), not
> per-request. There is no per-call header argument in the public methods.

## Timeouts & cancellation

Default timeout is 10s; override per client via `api({ timeout })` or globally
via `setInitConfig({ timeout })`. On timeout the request is **aborted** (via
`AbortController`) and `.timeout()` fires (or the awaited call throws a
`ParsedError<'timeout'>` if unhandled).

The high-level module methods (`accounts.getNonce`, `transactions.payment`, …)
do **not** accept a per-call options/`signal` argument — they use fixed request
options internally. Caller-supplied cancellation is only available through the
low-level `get`/`post` exports from `@1money/protocol-ts-sdk/client`, which do
accept an options object with a `signal`; that signal is merged with the SDK's
internal timeout abort signal.

## Utilities

Imported from the package root (`@1money/protocol-ts-sdk`).

### deriveTokenAddress(walletAddress, mintAddress)
Compute a wallet's associated token-account address offline (keccak-based
derivation) — no network call.

```typescript
import { deriveTokenAddress } from '@1money/protocol-ts-sdk';
const tokenAccount = deriveTokenAddress(
  '0xA634dfba8c7550550817898bC4820cD10888Aac5', // wallet
  '0x8E9d1b45293e30EF38564582979195DD16A16E13', // mint
); // → '0x…'
```

### toHex(value)
Convert booleans, numbers/bigints, integer strings, byte arrays, or arbitrary
values to a `0x…` hex string.

```typescript
import { toHex } from '@1money/protocol-ts-sdk';
toHex(true);  // '0x1'  (minimal hex, not zero-padded — README's '0x01' is wrong)
toHex(123);   // '0x7b'
toHex('hello'); // '0x68656c6c6f'
```

### calcTxHash(payload, signature)
Compute a transaction hash from a raw payload array + `{ r, s, v }`. Rarely
needed directly — prefer `SignedTx.txHash` from the builder flow, which is
computed for you. Use `calcTxHash` only for low-level/verification work.

### Deprecated: signMessage / encodePayload
`signMessage(payload, privateKey)` and `encodePayload(payload)` are legacy
`@deprecated` helpers retained for backward compatibility. **Do not use them for
new code** — `TransactionBuilder` + `createPrivateKeySigner` (see
`transactions.md`) is the supported, validated, malleability-safe path.

## Security checklist

- Load private keys from environment/secret managers; never hardcode or commit
  them. Example value strings in docs are placeholders.
- Use `testnet` (or `local`) while developing; switch the network deliberately.
- Keep peer deps (`axios`, `viem`, `@ethereumjs/rlp`) within the package's
  declared ranges; mismatches can break signing/encoding subtly.
