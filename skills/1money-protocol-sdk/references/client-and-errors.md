# Client, error handling, config & utilities

## The promise wrapper in depth

Every **read** method (and every `legacyV1.*` write) returns an object that is
**both** a `Promise` and a builder of handler chains, consumed one of two ways
below. The native v2 **write** methods (`transactions.payment`,
`tokens.issueToken`, and the rest of the `AuthorizedTxV2`-taking methods) are
plain `async` functions (`submitAuthorized` in `src/api/submit.ts`) and return
a native `Promise` only — no `.success()`/`.error()`/`.timeout()`/`.rest()`.
Always `await` a v2 write in a `try/catch`; see
[`TransactionHashMismatchError`](#transactionhashmismatcherror) below for why
that `catch` matters.

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

Every handler actually receives the response/request **headers** as a second
argument — `.success((res, headers) => …)`, `.error((err, headers) => …)`,
etc. This is how you'd inspect a response header such as
`X-1Money-Legacy-Signature` (see [v2 write errors](#v2-write-errors) below)
without reaching for a lower-level HTTP client.

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
  name: T;          // underlying error name (see timeout caveat below)
  message: string;
  stack: string;
  status: number;   // HTTP status, or 500 if none
  data?: any;       // server error body when present
}
```

> **Timeout discriminator caveat.** A timeout is typed `ParsedError<'timeout'>`,
> but that `'timeout'` is only the *type-level* tag — at runtime the object is a
> plain `Error('timeout')`, so `name === 'Error'` and **`message === 'timeout'`**.
> To detect a timeout in a `catch`, check `err.message === 'timeout'` (or just use
> the `.timeout()` handler), **not** `err.name === 'timeout'`.

## v2 write errors

Imported from the package **root only** — `isNativeV2NotActive`,
`isLegacyWriteDisabled`, `TransactionHashMismatchError`,
`TransactionSubmissionError`, `TransactionOutcomeUnknownError`, the
`TransactionSubmittedState` type (`= true | false | 'unknown'`), and the raw
`V2_ERROR_CODES` map are all root exports (`src/index.ts` re-exports
`./api/errors`); none of them are re-exported from `/api`. These only apply to
the native v2 / legacy v1 **write** surface — read endpoints don't raise them.

### The three outcomes of a v2 write

`submitAuthorized` (`src/api/submit.ts`, backing every `AuthorizedTxV2`-taking
method) classifies the result of `await client.<module>.<method>(authorized)`
into exactly three, deliberately distinct thrown-error shapes. **Branch on
`instanceof`, not on `.message` and not on a truthiness check of
`submitted`** — `submitted` is typed `TransactionSubmittedState = true |
false | 'unknown'` (exported from the package root), and only the two
strict-equality checks `submitted === true` / `submitted === false` carry
meaning on their own:

| Thrown | `submitted` | Safe to retry? | Meaning |
| --- | --- | --- | --- |
| `TransactionHashMismatchError` | `true` | **No** | The node admitted the write, but the hash it returned doesn't match the one computed locally. |
| `TransactionSubmissionError` | `false` | **Yes**, once the cause is fixed | The node refused the write outright (HTTP error with a response body, e.g. a 403/400/410) — it never reached the mempool. |
| `TransactionOutcomeUnknownError` | `'unknown'` | **No — verify first** | Ambiguous: e.g. a client-side timeout, a network error, or a 2xx body with no `hash`. The node may or may not have admitted the transaction. |

```typescript
import {
  TransactionHashMismatchError,
  TransactionSubmissionError,
  TransactionOutcomeUnknownError,
} from '@1money/protocol-ts-sdk';

try {
  const { hash } = await client.transactions.payment(authorized);
} catch (err) {
  if (err instanceof TransactionHashMismatchError) {
    // Already submitted. Do NOT retry -- look the transaction up by
    // err.localHash / err.serverHash instead.
  } else if (err instanceof TransactionSubmissionError) {
    // NOT submitted. err.status / err.errorCode identify why (see the five
    // v2 error codes below, or a plain HTTP error) -- fix the cause, then
    // retry is safe.
  } else if (err instanceof TransactionOutcomeUnknownError) {
    // Genuinely unknown. Query err.transactionHash against the node
    // (client.transactions.getByHash) before deciding whether to retry --
    // a blind retry risks double-submitting on the same nonce.
  } else {
    throw err;
  }
}
```

> **A falsy `submitted` is never "safe to retry" — only `submitted === false`
> is.** `TransactionOutcomeUnknownError.submitted` is the literal string
> `'unknown'`, not `undefined`/absent and not `false`. An earlier version of
> this error had no `submitted` field at all, on the theory that a caller
> checking `err.submitted === false` (`TransactionSubmissionError`'s
> contract) would then correctly fail to match. But the natural — and
> wrong — code people actually write is `if (!err.submitted) retry()`, which
> reads *any* falsy value as "not submitted, retry away". `undefined` is
> falsy, so that check would have retried on exactly the one outcome where
> retrying is most dangerous: the ambiguous case that may already be
> on-chain. `'unknown'` is truthy, so `if (!err.submitted)` correctly does
> **not** retry here, while `if (err.submitted === true)` still correctly
> declines to treat it as a confirmed submission. **Never write `if
> (!err.submitted)` or `if (err.submitted)` to decide whether to retry** —
> use `instanceof`, or `submitted === true` / `submitted === false`
> specifically.

> **Why this needed fixing:** the underlying HTTP client
> (`src/client/core.ts`) **resolves** its promise instead of rejecting it
> whenever the caller configured a global `onError`/`onTimeout` via
> `setInitConfig` — a documented, public option. Earlier, `submitAuthorized`
> only ever checked the resolved value for a string `hash`, so a refused
> write (e.g. a 403 because `/v2` isn't active yet) under a configured
> `onError` was misread as a hash-bearing response and thrown as
> `TransactionHashMismatchError` — telling the caller "already submitted, do
> not retry" for a transaction that never left the process. `submitAuthorized`
> now classifies both a caught rejection and a resolved
> `ParsedError`-shaped value the same way, so the three outcomes above hold
> regardless of whether a global `onError`/`onTimeout` is configured.

### The five error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE` | 403 | The node hasn't activated `/v2` yet (`NativeWriteMode` is `v1_only`). |
| `LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED` | 410 | The node has disabled the legacy `/v1` write surface (`NativeWriteMode` is `v2_only`). |
| `UNSUPPORTED_AUTHORIZATION_TYPE` | 400 | `authorization.type` isn't a recognized tag (`single_secp256k1` / `multisig_secp256k1`). |
| `DOMAIN_SEPARATED_SIGNATURE_REQUIRED` | 400 | A legacy top-level signature was posted to `/v2`. |
| `RAW_TRANSACTION_ENDPOINT_REMOVED` | 410 | `POST /v1/transactions/raw` is retired. |

The error arrives as a `ParsedError` whose `.data.error_code` carries one of
these strings. Two helpers check it for you instead of string-comparing
`err.data.error_code` yourself:

```typescript
import { isNativeV2NotActive, isLegacyWriteDisabled } from '@1money/protocol-ts-sdk';

try {
  await client.transactions.payment(authorized);
} catch (err) {
  if (isNativeV2NotActive(err)) {
    // The node hasn't turned on /v2 yet. A migration-window caller MIGHT
    // fall back to legacyV1 here -- but only by re-preparing and re-signing
    // the transaction with LegacyV1TransactionBuilder, never by resubmitting
    // the same authorized bytes to a different endpoint.
  } else if (isLegacyWriteDisabled(err)) {
    // The node has moved past dual-write; legacyV1 calls will 410 from here on.
  } else {
    throw err;
  }
}
```

Check `client.status.getNativeWriteStatus()` (see `api-reference.md`) to know
which surface is live *before* you submit, rather than discovering it from a
failed write.

### `X-1Money-Legacy-Signature: deprecated` response header

Once a node schedules the legacy signing scheme for removal, `legacyV1`
responses may carry an `X-1Money-Legacy-Signature: deprecated` header even
while the call still succeeds. Treat it as an early warning to plan a cutover
to `TransactionBuilder`, not as an error — read it via the `headers` argument
passed to `.success`/`.rest`, since a 2xx response won't otherwise surface it.
The node does not publish a fixed sunset date for the legacy surface;
operators run the cutover on their own schedule.

### `TransactionHashMismatchError`

```typescript
class TransactionHashMismatchError extends Error {
  readonly submitted: true;   // ALWAYS true when this is thrown
  readonly serverHash: string;
  readonly localHash: string;
}
```

Every v2 write (`client.transactions.payment`, `client.tokens.mintToken`, …)
re-derives the transaction hash from the bytes it signed and compares it,
fail-closed, against the hash the node returns. A mismatch throws this error
— **and by the time it throws, the transaction was already accepted by the
node.** `submitted` is `true` unconditionally; there is no "not sent" case for
this error. Do not retry: retrying resubmits a *second*, distinct transaction
on the same nonce, because the node already consumed the first one. A
mismatch means the bytes the node admitted differ from what was signed
locally — an SDK/encoding defect or a request mutated in transit, not
evidence of a dishonest node (the check runs after admission, and a
dishonest node could simply echo back the hash it was given).

```typescript
import { TransactionHashMismatchError } from '@1money/protocol-ts-sdk';

try {
  const { hash } = await client.transactions.payment(authorized);
} catch (err) {
  if (err instanceof TransactionHashMismatchError) {
    // err.submitted === true — look the transaction up by err.localHash /
    // err.serverHash instead of resubmitting.
    console.error('hash mismatch, do not retry:', err.localHash, err.serverHash);
  } else {
    throw err;
  }
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
`ParsedError<'timeout'>` if unhandled — runtime `message === 'timeout'`, see the
caveat under ParsedError shape).

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
toHex(true);  // '0x1'  (minimal hex, not zero-padded)
toHex(123);   // '0x7b'
toHex('hello'); // '0x68656c6c6f'
```

### calcTxHash(payload, signature)
Compute a transaction hash from a raw payload array + `{ r, s, v }`. This is a
**legacy v1** helper: it matches `LegacyV1TransactionBuilder`'s
`SignedTx.txHash`, not the v2 `AuthorizedTxV2.transactionHash` (which uses a
different, domain-separated hashing scheme — see `transactions.md`). Rarely
needed directly; use it only for low-level/verification work against the
legacy scheme.

### deriveMultisigAddress(signers, threshold)
Compute the address a native multisig account will get *before* creating it
(pure, offline, keccak-based — no network call). See `transactions.md` →
`deriveMultisigAddress` for the full signature and error cases.

```typescript
import { deriveMultisigAddress } from '@1money/protocol-ts-sdk';
const address = deriveMultisigAddress(
  [{ public_key: '0x02...', weight: 1 }, { public_key: '0x03...', weight: 1 }],
  2
); // → '0x…'
```

### validateMemo / MemoValidationError / Memo
For attaching a memo to a transaction (see `transactions.md` → Memo). `Memo` is
`{ type?, format?, data? }`. The builders call `validateMemo` for you when a memo
is present; call it yourself to pre-validate user input. It throws
`MemoValidationError` (with a `.code`) on oversize or illegal-character subfields.

```typescript
import { validateMemo, MemoValidationError } from '@1money/protocol-ts-sdk';
try {
  validateMemo({ type: 'invoice', data: userInput });
} catch (e) {
  if (e instanceof MemoValidationError) console.error(e.code, e.message);
}
```

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
