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

### Batch Payment estimate versus submission

`client.transactions.estimateBatchPaymentFee({ from, token, operations })` is
an unsigned `POST /v1` estimate but deliberately uses this normal
promise-wrapper behavior. Handle its validation, transport, and timeout errors
with `.error()`/`.timeout()` or a normal `try/catch`, exactly as for a read. Its
`{ fee: string; plan?: string }` response is non-binding and does not mean a
transaction entered admission.

`client.transactions.batchPayment(authorized)` is different: it is a native-v2
submission and returns a plain promise. Its failures use the retry-safety
semantics in [the outcomes of a v2 write](#the-outcomes-of-a-v2-write).
Do not treat an estimate error as a submission outcome, and do not retry an
ambiguous submit just because a previous estimate succeeded.

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
  problem?: ApiProblem; // parsed problem details of `data`, when present
}
```

`ApiProblem` (a type export of the root and of `/client`, `src/api/problem.ts`) is the node's RFC 9457
problem body: `type` (the type URI; compare the whole string), `action` (one of
the five client actions, `undefined` when missing or unknown), `instance` (the
request ID, `urn:uuid:<id>`), `title`, `status`, and `members` (the typed
members of the type, as sent; nested values are shared with `data`), with the
accessors `txHash` (`tx_hash` as sent) and `retryAfterSecs`. `problem` is absent when the body has no string `type`
(an older node, or an empty or text body). With the default login rule
(`isLogin`, `src/client/index.ts`), an HTTP 401 never becomes a `ParsedError`:
the client passes the raw body to `.login()`, or resolves the promise with it, so it has no
`problem`; read `type` and `action` from that body. Decide on `problem.type` and
`problem.action`, never on `message` or `title`. A 404 with type
`route_not_found` is a wrong path, not a missing record.

> **Timeout discriminator caveat.** A timeout is typed `ParsedError<'timeout'>`,
> but that `'timeout'` is only the *type-level* tag — at runtime the object is a
> plain `Error('timeout')`, so `name === 'Error'` and **`message === 'timeout'`**.
> To detect a timeout in a `catch`, check `err.message === 'timeout'` (or just use
> the `.timeout()` handler), **not** `err.name === 'timeout'`.

## v2 write errors

Imported from the package **root only** — `isNativeV2NotActive`,
`isLegacyWriteDisabled`, `TransactionHashMismatchError`,
`TransactionLockedError`, `TransactionSubmissionError`,
`TransactionOutcomeUnknownError`, the
`TransactionSubmittedState` type (`= true | false | 'unknown'`), and the raw
`V2_ERROR_CODES` map are all root exports (`src/index.ts` re-exports
`./api/errors`); none of them are re-exported from `/api`. These only apply to
the native v2 / legacy v1 **write** surface — read endpoints don't raise them.

### The outcomes of a v2 write

A signed transaction is in one of three states at the node: **rejected before
admission** (no lock, nonce not used), **admitted and locked** (holds the
sender's nonce, not executed yet), or **consumed** (executed). When no answer
tells which, the state is **unknown**. Two rules follow:

- **Safety:** sign a new transaction for the same intent, at any nonce, only
  when the node rejected the request before admission, and no other
  transaction for the intent is locked, consumed, or unknown. Otherwise a
  payment can execute twice.
- **Liveness:** the node does not broadcast a locked transaction again by
  itself. Resend the **same signed bytes** (the same `AuthorizedTxV2`) until
  the transaction executes. A resend of the same bytes can never execute
  twice: the node treats the same hash as the same transaction.

`submitAuthorized` (`src/api/submit.ts`, backing every
`AuthorizedTxV2`-taking method) classifies the answer
(`src/api/classify.ts`). **Branch on `instanceof`, not on `.message` and not
on a truthiness check of `submitted`** — `submitted` is typed
`TransactionSubmittedState = true | false | 'unknown'` (exported from the
package root), and only the two strict-equality checks `submitted === true` /
`submitted === false` carry meaning on their own:

| Thrown | `submitted` | Sign a new transaction for the intent? | Meaning |
| --- | --- | --- | --- |
| *(none — resolves with `{ hash }`)* | — | **No** | The node admitted the transaction (locked or executed). |
| `TransactionHashMismatchError` | `true` | **No** | The node admitted the write, but the hash it returned doesn't match the one computed locally. |
| `TransactionLockedError` | `true` | **No** — resend the same `authorized` until it executes | The node holds this exact transaction (`action: in_progress`). |
| `TransactionSubmissionError` | `false` | **Only** after you fix the cause, and only if no other transaction for the intent is locked, executed, or unknown | The node rejected this request before admission. |
| `TransactionOutcomeUnknownError` | `'unknown'` | **No** — find the state first: look up the hash, resend the same `authorized` | The answer does not tell whether the node admitted the transaction. |

`TransactionSubmissionError` and `TransactionOutcomeUnknownError` carry
`action` (the body's `action`; on the unknown error it can be a value this SDK
does not know) and `problemType` (the problem `type` URI), when the node sent
them. When one submit throws them, they also carry `problem`, the parsed
`ApiProblem` of the body (see [ParsedError shape](#parsederror-shape)). The
errors that `settle` and `submitAndSettle` throw at the end have no body, so
`problem` is absent there; read `observations`. `action` and `problemType` stay
the fields to classify on: `problem` needs a string `type`, which an older node
does not send. `TransactionLockedError` and
`TransactionOutcomeUnknownError` keep the raw `status` and `data` body; the unknown error also keeps the parsed
transport value as `cause`. These fields explain the observation only; they do
not make an unknown outcome safe to sign again.

**The node's `action` decides; the HTTP status decides only when the body has
no `action`.** Nodes with the API error contract send an RFC 9457 problem body
with an `action` member on every error. Older nodes and gateways do not. The
first matching rule wins:

| # | Answer | Outcome |
| --- | --- | --- |
| 1 | A string `hash` in the body | resolves (hash checked) |
| 2 | `action` is `fix_request`, `retry_later`, or `use_other_node` (any status, also a 5xx such as `node_syncing`) | `TransactionSubmissionError` |
| 3 | `action` is `in_progress`, and `tx_hash` is absent or equals the local hash | `TransactionLockedError` |
| 4 | Any other `action` value (`check_status`, an unknown value, `in_progress` with another hash or a `tx_hash` that is not a string) | `TransactionOutcomeUnknownError` |
| 5 | No `action`; `422` with `error_code: business_transaction_failed` | `TransactionOutcomeUnknownError` |
| 6 | No `action`; `408` | `TransactionOutcomeUnknownError` |
| 7 | No `action`; any other `4xx` with a body, or the body-only `401` shape | `TransactionSubmissionError` |
| 8 | Anything else: `5xx`, timeout, network error, no body, 2xx without `hash` | `TransactionOutcomeUnknownError` |

Why the rules for a body without `action` are this narrow:

- **`422 business_transaction_failed` is unknown (rule 5).** On a node
  without `action`, this one code covers "already inflight" (the node holds
  this exact transaction), the nonce-lock answers, and real refusals alike.
  A resend of a held transaction gets it, so it can follow admission. Some
  real refusals (for example a nonce gap) therefore read as unknown on such a
  node; that errs on the safe side.
- **`408` is unknown (rule 6).** l1client's REST layer wraps every handler —
  including the pool-admission call — in a `tokio::time::timeout` (10s) that
  answers `408` and discards whatever the handler was doing if the clock wins
  the race. If admission completes a hair too late, the transaction can be on
  the node despite the `408`.
- **A `5xx` without `action` is unknown (rule 8).** l1client's `500` bucket
  mixes rejections before admission with failures that can follow it, and a
  `502`/`503`/`504` from a load balancer in front of the node can follow a
  successful admission as easily as precede one. With `action`, a `5xx` that
  proves no effect (`retry_later`) is a rejection (rule 2).
- **Every other `4xx` without `action` is a rejection (rule 7).** The node
  returns those synchronously, before it calls the pool. A firewall or load
  balancer `4xx` (for example a WAF `429` or `403`) comes before the request
  reaches the node.
- **A `401` whose HTTP status never reaches `submitAuthorized` still counts as
  a rejection.** The underlying HTTP client's login branch (`src/client/
  core.ts`, triggered by the shared `isLogin` rule in `src/client/index.ts`:
  `status === 401 || res.code == 401`) resolves with just the response body,
  discarding the numeric status. `submitAuthorized` recognizes this shape — a
  body with `code == 401` (the same loose equality `isLogin` itself uses) —
  and throws `TransactionSubmissionError` with `status: 401`.
- **No rule reads message text.**

```typescript
import {
  TransactionHashMismatchError,
  TransactionLockedError,
  TransactionSubmissionError,
  TransactionOutcomeUnknownError,
} from '@1money/protocol-ts-sdk';

try {
  const { hash } = await client.transactions.payment(authorized);
} catch (err) {
  if (err instanceof TransactionHashMismatchError) {
    // Already submitted. Do NOT sign again -- look the transaction up
    // by err.localHash / err.serverHash instead.
  } else if (
    err instanceof TransactionLockedError ||
    err instanceof TransactionOutcomeUnknownError
  ) {
    // Locked or unknown. Resend the SAME `authorized` (never a new
    // signature) until its receipt appears; settle() does this.
    const { receipt } = await client.transactions.settle(authorized);
  } else if (err instanceof TransactionSubmissionError) {
    // Rejected before admission. err.action / err.status /
    // err.errorCode identify why -- fix the cause, then send again.
  } else {
    throw err;
  }
}
```

### Settling a write: `submitAndSettle` and `settle`

`transactions.submitAndSettle(authorized, options?)` sends a signed transaction
that was never sent; `transactions.settle(authorized, options?)` resumes after an
earlier send (for example after a `TransactionLockedError` or a
`TransactionOutcomeUnknownError`). Both resend the **same signed bytes** on the
node's retry schedule until `getReceiptByHash` returns a receipt for the hash,
and resolve with `{ transactionHash, receipt }`. They never build or sign a
transaction. Read `receipt.success`: a hold debit can execute and still fail.
They copy `authorized` when they start, so a later change to that object does
not change what they send. No send starts after the deadline.

- Resends follow the node's retry gate: send k+1 goes out `resendIntervalMs ×
  k` after send k (default 70 000 ms, so 70, 140, 210, 280 s apart). A resend
  of the same bytes can never execute twice.
- Receipt polls start at `pollIntervalMs` (1 000 ms) and double to
  `maxPollIntervalMs` (10 000 ms). In the unknown state each poll also looks
  up the transaction; a 200 there means locked.
- A lookup answered `429` or `retry_later` changes nothing and waits
  `throttleBackoffMs` (60 000 ms): a firewall in front of the node blocks an IP
  address above about 120 reads per minute, and that block also stops the
  caller's other reads.
- A send answered with the problem type `nonce_too_low` means the nonce is
  used. The helper stops resending, polls the receipt for `nonceUsedGraceMs`
  (70 000 ms, cut at `deadlineMs`), and without a receipt throws the error for
  the last known state. It never says "rejected": a missing receipt can be a
  node that is behind. Do not sign the intent again until you know whether
  this hash executed. A node that sends no problem `type` keeps the full
  resend schedule.
- Proof only gets stronger: locked never goes back to unknown. Only the first
  send of `submitAndSettle` can end as `TransactionSubmissionError`.
- At `deadlineMs` (900 000 ms) or on `signal` abort, it throws
  `TransactionLockedError` or `TransactionOutcomeUnknownError` with
  `observations` (at most 200, numbered by `seq`). Exception: when the signal
  is already aborted, `submitAndSettle` throws a plain `Error` and sends
  nothing.

> **A falsy `submitted` never means "not submitted" — only `submitted ===
> false` does, and only for that one request.** `TransactionOutcomeUnknownError.submitted` is the literal string
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
> specifically. Even `submitted === false` tells you about this request only;
> see the safety rule in [the outcomes of a v2 write](#the-outcomes-of-a-v2-write).

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
> `ParsedError`-shaped value the same way, so the outcomes above hold
> regardless of whether a global `onError`/`onTimeout` is configured.

> **Why the refused/unknown split needed a second fix:** an earlier version
> of `isRefusedResponse` treated *any* numeric HTTP status with a response
> body as refused, so a `502` from a gateway or a `500` from the node itself
> both threw `TransactionSubmissionError` — "NOT submitted, safe to retry" —
> even though either can follow a successful admission (see the `5xx`/`408`
> bullets above). That was actively dangerous: a caller following the
> documented contract would retry the same nonce and double-submit. The fix
> narrows "refused" to `4xx` excluding `408`, and separately teaches
> `submitAuthorized` to recognize the body-only `401` shape the login branch
> produces (see the `401` bullet above), which previously fell through to
> `TransactionOutcomeUnknownError` despite being just as pre-admission as any
> other refusal.

> **Why it needed a third fix:** the `4xx`-means-refused rule still read a
> `422` "already inflight" answer as "NOT submitted, safe to retry". The node
> sends that answer to a resend of a transaction it already holds, so a
> caller that trusted the error signed a new transaction for the same intent,
> and the payment could execute twice. The SDK now reads the node's `action`
> member, and treats `422 business_transaction_failed` without `action` as
> unknown.

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
