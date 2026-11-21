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
the five client actions, `undefined` when missing, unknown, or under a `type`
that is neither the node's nor `about:blank`), `instance` (the
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

All four submit errors expose the boolean `nonceUsed`. It is `true` when a
response to the call is unknown and reports the exact `nonce_too_low` problem
type (the node sends it with `check_status`). An earlier transaction, possibly this one, used
the nonce. Never sign again at this nonce; look up this transaction's hash
first. `false` means the call has no such evidence; it does not prove that the
nonce is unused. The flag does not change the `submitted` contract.

When one submit throws `TransactionLockedError` or
`TransactionOutcomeUnknownError`, the error holds the signed transaction it sent
in `authorized`. A helper that builds the transaction (`issueLaneClawback`)
leaves no other copy of it: read `laneClawbackFate(error.authorized)`.

Errors from `settle` and `submitAndSettle` set `nonceUsed: true` when
`endReason` is `nonce_used`. They retain the flag if the run is aborted after
such a response, even if its earlier state was locked. The end reason is then
`aborted`, and the error is `TransactionOutcomeUnknownError`.

`TransactionSubmissionError` and `TransactionOutcomeUnknownError` carry
`action` (the node's `action`; on the unknown error it can be a value this SDK
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

**Only the node's `action` decides.** The node's action is the `action`
member of a body whose `type` is in the node's namespace
(`https://developer.1moneynetwork.com/problem/...`) or is `about:blank`. Nodes
with the API error contract (l1client v0.8.12 on) send it on every error. Any
other body is data only: a body without problem details, a problem with another
`type`, or an `action` without a `type`. A firewall, a proxy or a load balancer
in front of the node can send such a body. The first matching rule wins:

| # | Answer | Outcome |
| --- | --- | --- |
| 1 | A `2xx` with a string `hash` | resolves (hash checked) |
| 2 | The node's `action` is `fix_request`, `retry_later`, or `use_other_node` (any status, also a 5xx such as `node_syncing`) | `TransactionSubmissionError` |
| 3 | The node's `action` is `in_progress`, and `tx_hash` is absent or names the local hash (hex digits in any case; a lowercase `0x` prefix or none, never `0X`) | `TransactionLockedError` |
| 4 | Any other node `action` (`check_status`, an unknown value, `in_progress` with another hash or a `tx_hash` that is not a string) | `TransactionOutcomeUnknownError` |
| 0 | A `3xx`, or an answer that came after a redirect the browser followed (`redirected: true`) | `TransactionOutcomeUnknownError` |
| 5 to 8 | No node `action`, whatever the status, `error_code` or message: a `422` `business_transaction_failed`, a `408`, any other `4xx` (a firewall `403` or `429`, the body-only `401` shape), a `5xx`, a timeout, a network error, no body, a `2xx` without `hash` | `TransactionOutcomeUnknownError` |

Rule 0 comes first: the node never redirects a submit, so a `3xx` or a
redirected answer is someone else's answer. This is stricter than the Rust SDK,
which classifies a `3xx` like any other status. The SDK's own requests follow
no redirect (`maxRedirects: 0` in Node, `redirect: 'manual'` for fetch). A
browser's `XMLHttpRequest` follows anyway; the SDK then marks the
`ParsedError` with `redirected: true`, and a read with that mark fails.

Only an action proves that a request had no effect: a status cannot. A `422`
`business_transaction_failed` covers answers that can follow admission, a
`408` can come after admission won the race against the node's request
timeout, a `5xx` can follow admission, and a `4xx` from a firewall or a proxy
says nothing about the node. No rule reads message text. These rules match the
Rust SDK `onemoney-protocol` (l1client `crates/om-sdk/src/submit/classify.rs`).

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
and settles it; `transactions.settle(authorized, options?)` resumes after an
earlier send (for example after a `TransactionLockedError` or a
`TransactionOutcomeUnknownError`). Both resend the **same signed bytes** on the
node's retry schedule until `getReceiptByHash` returns a receipt for the hash,
and resolve with `{ transactionHash, receipt }`. They never build or sign a
transaction. Read `receipt.success`: a hold debit can execute and still fail.
They copy `authorized` when they start, so a later change to that object does
not change what they send. No send starts after the deadline.

- **First send of `submitAndSettle`:** classified like a single send. A
  rejection (rule 2) throws `TransactionSubmissionError` at once, with the
  node's message, except with HTTP status `429`: then the first send goes out
  again when the hold ends, and nothing is read before a send reaches a node.
  If the deadline passes or the signal aborts first, the bytes reached no node,
  and the helper throws `TransactionSubmissionError` with the last `429`. Every
  other answer, `nonce_too_low` and `check_status` included, goes on to settle
  from that answer, with no resend at once. The helper uses no history from
  before the call: a `nonce_too_low` can come from this transaction's own
  earlier send.
- **Answers without the node's action** (rules 5 to 8, for example a node
  without problem details, or a firewall `403` or `429`) are unknown, so the
  helper settles and ends after about 10 s with
  `TransactionOutcomeUnknownError` (`not_found_after_probes`). Use the helpers
  with nodes that send problem details.
- **Your own history:** `observations` on `TransactionOutcomeUnknownError` hold
  the node's answer to each send. An application that knows the signed bytes
  were never sent before can read the first answer with that knowledge: for
  example, `nonce_too_low` there means that another transaction used the
  nonce.
- **A refusal of the signed bytes** (rule 2 with a bytes problem type) throws `TransactionSubmissionError` on any send of either helper, while
  no node is known to have admitted the transaction. After a `2xx` or a lookup
  that found it, such a refusal means the nodes disagree, and it ends nothing.
  Any other refusal of a later send says nothing about an earlier send.
- **States:** a `2xx` means accepted; locked needs a lookup that finds the
  transaction, or a node that says it holds it. Locked never goes back.
- **Probes:** while no node is known to hold it, a lookup that answers `404`
  starts a resend at once, at most three (about 1, 3 and 7 s after the first
  send): the node's retry gate forwards a hash it does not hold. After the
  probes, three `404` lookups in a row end the run with
  `TransactionOutcomeUnknownError` and `endReason: 'not_found_after_probes'`,
  about 10 s after the first send. A failed or rate-limited read never counts.
- **Resends** go out every `resendIntervalMs` (default 70 000 ms) in every
  state, from the last delivered resend or from the moment the transaction
  became locked: a rebroadcast helps only after peers forget the last one (60 s
  gossip duplicate cache + 10 s publish queue). A resend of the same bytes can
  never execute twice.
- **Throttled sends:** after a send answered HTTP `429` or the node's
  `retry_later`, no send goes out for the node's `retry_after_secs` (a whole
  number of seconds in a problem body), or `throttleBackoffMs` (60 000 ms)
  without it; the receipt polls go on. Only a rejection (the node's
  `retry_later`) proves that the send delivered nothing: it does not count as a
  probe or a resend, so a run whose sends keep being rejected this way ends at
  the deadline. A `429` without the node's action may have reached a node, so
  it counts.
- **Polls** start at `pollIntervalMs` (1 000 ms) and double to
  `maxPollIntervalMs` (10 000 ms); right after a `404` read the next poll
  comes after `pollIntervalMs`. A read answered HTTP `429` or the node's
  `retry_later` waits the node's `retry_after_secs`, or `throttleBackoffMs` (60 000 ms) without it,
  and for the rest of the run `404`s no
  longer shorten the wait: a firewall in front of the node blocks an IP address
  above about 120 reads per minute.
- **`nonce_too_low`** (the problem type) means the nonce is used, so no send can help: the helper stops sending and
  reads only the receipt. Three receipt `404`s in a row end the run with
  `endReason: 'nonce_used'`; `nonceUsedGraceMs` (70 000 ms) is the limit when
  the reads keep failing. It never says "rejected": a missing receipt can be a
  node that is behind. It ends with `TransactionOutcomeUnknownError` even when
  a node held the transaction, because a resend can no longer help. Do not
  sign the intent again until you know whether this hash executed.
- **Other ends:** at `deadlineMs` (900 000 ms) or on `signal` abort, it throws
  `TransactionLockedError` (never for `nonce_used`) or
  `TransactionOutcomeUnknownError`. Both carry
  `endReason` (`deadline`, `nonce_used`, `not_found_after_probes`, `aborted`)
  and `observations` (at most 200, numbered by `seq`; send entries carry the
  node's `message`). Exception: when the signal is already aborted,
  `submitAndSettle` throws a plain `Error` and sends nothing.

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

> **Why the status and text rules went away:** the Rust SDK
> `onemoney-protocol` is the canonical SDK behavior, and it reads only the
> node's own statement (l1client issue #1730). A `4xx` from a firewall or a
> proxy says nothing about the node, and every node with problem details sends
> an `action`. So a `4xx` without the node's action, the body-only `401` and
> the pinned texts of released nodes are now unknown, never rejected or locked.

### Token authority refusals

`authorityRefusalOf(error)` returns the typed refusal of the
[token authority model](transactions.md#token-authority-model-settled-envelope-and-lane-clawback), or `undefined`. It counts only a
`TransactionSubmissionError`, which proves the request had no effect. Every
refusal below took no nonce and no lock. The problem type URIs are in
`AUTHORITY_REFUSAL_TYPES`.

| `kind` | Members | What to do |
| --- | --- | --- |
| `legacy_envelope_retired` | none | Never send the legacy form again. Read the envelope mode; on `settled`, sign the operation again as the new envelope at the same nonce; otherwise try again later. `sendAuthorityOperation` does this. If `GET /api/status` is hidden (`status_answered`), the mode stays legacy: name the envelope with `sendAuthorityOperation('settled', …)` |
| `settled_envelope_not_active` | none | Try the same transaction again later |
| `reference_checkpoint_not_committed` | `checkpointId`, `checkpointIdLatest` | Try again once the node commits `r` |
| `reference_checkpoint_too_old` | `checkpointId`, `checkpointIdEarliest` | Sign again with a recent `r` only if the transaction was never sent: the node checks `r` before the nonce, so an executed one gets this answer too. Else read its state first |
| `token_not_at_reference_checkpoint` | `mintAddress`, `checkpointId` | Not evidence that the token does not exist. Sign again later with a later `r` |

A member is missing when an older node did not send it. A lane clawback of
VERIFY gets `not_authorized`; the SDK refuses it before it signs.

Errors the token authority helpers throw before or around a send:

- `UpgradeGapError` (`submitted: false`): the node is in the upgrade gap.
  Nothing was sent.
- `UnrecognizedEnvelopeModeError` (`submitted: false`, `reported`): a mode this
  SDK does not know. Nothing was sent; upgrade the SDK.
- `AuthorityReadError` (`status?`): a state read gave no answer this SDK can
  read and no 404: an HTTP error, no answer, an unknown status, or a receipt
  it cannot read. It says nothing about the transaction.
- `laneClawbackRecordOf` (and `laneClawbackFate`) throws a plain `Error` for a
  stored lane clawback whose hash does not match its request.

A soft fail is not a refusal: it is certified, uses the nonce, and has a
receipt with `success: false` and a `SoftFail` event (`receiptOutcomeOf`).

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

## Error logging

The request core writes one `console.error` line for each rejected request
(an HTTP error status, a network error), before any handler runs. The line
does not change the result. Expiry of the request `timeout` writes no line: it
calls the timeout handler.

The low-level `get`/`post` exports take `quietStatuses`, a list of HTTP
statuses that are an expected answer for that request, such as `[404]` while a
receipt is not there yet. A rejection with a listed status writes no line.
Every other rejection, such as a network error, still logs.

The SDK sets `quietStatuses: [404]` on the reads where a 404 is a normal
answer: the receipt and transaction reads of `submitAndSettle` and `settle`,
and the receipt and status reads of `authorityOperationState` and
`laneClawbackFate`. Their waits and polls log nothing while they read 404, and
still log a 5xx, a 429 or a network error. Other reads still log a 404: the
nonce, checkpoint, token metadata and envelope-mode reads of the authority
helpers, where a 404 is an error, and high-level methods such as
`transactions.getReceiptByHash`.

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
