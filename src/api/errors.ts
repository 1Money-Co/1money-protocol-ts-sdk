import { parseProblem } from './problem';

import type { ApiProblem, ClientAction } from './problem';
import type { SettleObservation } from './settle';

// Error codes specific to the /v2 domain-separated
// write surface.
export const V2_ERROR_CODES = {
  // 403 - the node has not activated /v2 yet
  // (NativeWriteMode V1Only).
  DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE:
    'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE',
  // 410 - the node disabled the legacy /v1 write
  // surface (NativeWriteMode V2Only).
  LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED:
    'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED',
  // 400 - authorization.type is not a recognized
  // tag.
  UNSUPPORTED_AUTHORIZATION_TYPE:
    'UNSUPPORTED_AUTHORIZATION_TYPE',
  // 400 - a legacy top-level signature was posted
  // to /v2.
  DOMAIN_SEPARATED_SIGNATURE_REQUIRED:
    'DOMAIN_SEPARATED_SIGNATURE_REQUIRED',
  // 410 - POST /v1/transactions/raw is retired.
  RAW_TRANSACTION_ENDPOINT_REMOVED:
    'RAW_TRANSACTION_ENDPOINT_REMOVED'
} as const;

export type V2ErrorCode =
  (typeof V2_ERROR_CODES)[keyof typeof V2_ERROR_CODES];

// The three possible `submitted` values across the write-outcome
// error hierarchy below (TransactionHashMismatchError /
// TransactionLockedError / TransactionSubmissionError /
// TransactionOutcomeUnknownError). `true` covers both
// TransactionHashMismatchError and TransactionLockedError.
// Exported so callers can name the union explicitly instead of
// re-deriving it. `true` and `false` are unconditional and safe to
// branch on with strict equality; `'unknown'` is deliberately a
// truthy, non-boolean value -- see TransactionOutcomeUnknownError.
// Never treat a falsy `submitted` as "not submitted": only
// `submitted === false` means that, and only for that one request
// (signing the intent again is safe only when no other transaction
// for it is locked, executed, or unknown). Prefer `instanceof` over
// reading `submitted` at all when you have the error classes in
// scope.
export type TransactionSubmittedState =
  | true
  | false
  | 'unknown';

// The transaction WAS accepted by the node before
// this was thrown. `submitted` is load-bearing:
// treating this as "not sent" and retrying would
// submit a second transaction on the same nonce.
//
// A mismatch means the bytes the node admitted are
// not the bytes that were signed locally -- an SDK
// encoding defect or a request body mutated in
// transit -- not a dishonest node (the check runs
// after submission, and a dishonest node could echo
// the expected hash).
export class TransactionHashMismatchError extends
  Error {
  readonly submitted = true;
  readonly serverHash: string;
  readonly localHash: string;

  constructor(
    localHash: string,
    serverHash: string
  ) {
    super(
      `[1Money SDK]: Transaction hash mismatch - the transaction was submitted, but the node returned ${serverHash} while the SDK computed ${localHash}. Do not retry: a retry would submit a second transaction on the same nonce.`
    );
    this.name = 'TransactionHashMismatchError';
    this.localHash = localHash;
    this.serverHash = serverHash;
  }
}

// Exported so classify.ts can read the node's error_code out of a
// resolved-not-rejected ParsedError-shaped value when classifying a
// submit response.
export function errorCodeOf(
  error: unknown
): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null
  ) {
    return undefined;
  }
  const data = (
    error as { data?: { error_code?: unknown } }
  ).data;
  return typeof data?.error_code === 'string'
    ? data.error_code
    : undefined;
}

// The node rejected this request before admission:
// the body's `action` proves no effect (fix_request,
// retry_later, use_other_node), or, on a node without
// the `action` member, the status is a 4xx that cannot
// follow admission, or the message is a released node's
// refusal of the signed bytes (see src/api/classify.ts).
// This
// request did not lock the transaction or use its
// nonce. `submitted` is `false` for this request only:
// it says nothing about an earlier send of the same
// transaction, or about another transaction for the same
// intent.
export class TransactionSubmissionError extends
  Error {
  readonly submitted = false;
  readonly status: number;
  readonly errorCode?: string;
  // The node's raw response body (not just the extracted
  // `errorCode`) -- preserved so `isNativeV2NotActive` /
  // `isLegacyWriteDisabled` (which read `.data.error_code`) keep
  // working exactly as documented against a refused v2 write. Before
  // this error type existed, that refusal reached the caller as a
  // raw ParsedError with the same `.data` shape; this replaces that
  // shape, not narrows it.
  readonly data?: unknown;
  // The node's `action`, when the body had one.
  readonly action?: ClientAction;
  // The problem `type` URI, when the body had one.
  readonly problemType?: string;
  readonly problem?: ApiProblem;

  constructor(
    status: number,
    data: unknown,
    nodeMessage: string,
    problem: {
      action?: ClientAction;
      problemType?: string;
    } = {}
  ) {
    const errorCode = errorCodeOf({ data });
    super(
      `[1Money SDK]: Transaction rejected before admission (HTTP ${status}${errorCode ? `, ${errorCode}` : ''}): ${nodeMessage}. This request did not lock the transaction or use its nonce. Fix the cause before you send again. Sign a new transaction for the same intent only if no other transaction for it is locked, executed, or in an unknown state.`
    );
    this.name = 'TransactionSubmissionError';
    this.status = status;
    this.errorCode = errorCode;
    this.data = data;
    this.action = problem.action;
    this.problemType = problem.problemType;
    this.problem = parseProblem(data);
  }
}

// The node holds this exact transaction: it is admitted
// and locked (it holds the sender's nonce), but not
// executed yet. The node answers `action: in_progress`
// (a released node: "already inflight; please retry
// later") to a resend that comes before its retry gate
// allows one. The node does not broadcast a locked transaction
// again by itself: resend the same signed bytes until
// the transaction executes. Never sign a new transaction
// for the same intent while it is locked.
export class TransactionLockedError extends Error {
  readonly submitted = true;
  readonly action = 'in_progress' as const;
  readonly transactionHash: string;
  readonly problemType?: string;
  /** Raw transport metadata, when the client received it. */
  readonly status?: number;
  /** Raw transport response body, when the client received it. */
  readonly data?: unknown;
  readonly problem?: ApiProblem;
  /** Every request and answer of a settle run, oldest first. */
  readonly observations?: readonly SettleObservation[];

  constructor(
    transactionHash: string,
    diagnostic: {
      status?: number;
      data?: unknown;
      problemType?: string;
      observations?: readonly SettleObservation[];
    } = {}
  ) {
    super(
      `[1Money SDK]: The node holds transaction ${transactionHash}: it is admitted and locked, but not executed yet. Resend the same signed transaction until it executes (settle() does this). Do not sign a new transaction for the same intent, at any nonce, while it is locked.`
    );
    this.name = 'TransactionLockedError';
    this.transactionHash = transactionHash;
    this.status = diagnostic.status;
    this.data = diagnostic.data;
    this.problemType = diagnostic.problemType;
    this.problem = parseProblem(diagnostic.data);
    this.observations = diagnostic.observations;
  }
}

// The response does not tell whether the node admitted
// the transaction: `action: check_status` or an action
// the SDK does not know; on a node without `action`, a
// 422 `business_transaction_failed` or a 408; a 5xx, a
// timeout, a network error, or a 2xx body without a
// hash. The transaction may be rejected, locked, or
// already executed, so unlike TransactionSubmissionError
// this must NOT claim "safe to retry".
//
// `submitted` is the literal string 'unknown', not `undefined`/absent.
// An earlier version of this error had no `submitted` field at all, on
// the theory that `err.submitted === false` (TransactionSubmissionError's
// contract) would then correctly fail to match. But `undefined` is
// FALSY, and the natural (wrong) caller code is `if (!err.submitted)
// retry()` -- that reads "not submitted" as "falsy", not as "exactly
// false", so an absent field made the single most dangerous outcome
// (possibly already on-chain) satisfy the least safe check. `'unknown'`
// is truthy, so `if (!err.submitted)` no longer retries here, while
// `if (err.submitted === true)` still correctly declines to treat this
// as a confirmed submission. Query `transactionHash` against the node
// before deciding what to do next.
export class TransactionOutcomeUnknownError extends
  Error {
  readonly submitted = 'unknown' as const;
  readonly transactionHash: string;
  /** Raw transport metadata, when the client received it. */
  public readonly status?: number;
  /** Raw transport response body, when the client received it. */
  public readonly data?: unknown;
  /** Original parsed transport result, when available. */
  public readonly cause?: unknown;
  /**
   * The body's `action` value as sent, when it had one. It
   * can be a value this SDK does not know.
   */
  public readonly action?: unknown;
  /** The problem `type` URI, when the body had one. */
  public readonly problemType?: string;
  public readonly problem?: ApiProblem;
  /** Every request and answer of a settle run, oldest first. */
  public readonly observations?: readonly SettleObservation[];

  constructor(
    transactionHash: string,
    diagnostic: {
      status?: number;
      data?: unknown;
      cause?: unknown;
      action?: unknown;
      problemType?: string;
      observations?: readonly SettleObservation[];
    } = {}
  ) {
    super(
      `[1Money SDK]: Transaction outcome unknown: the SDK cannot confirm whether the node admitted transaction ${transactionHash}. Find its state first: look up the hash and resend the same signed transaction (settle() does both). Do not sign a new transaction for the same intent, at any nonce, until you know its state.`
    );
    this.name = 'TransactionOutcomeUnknownError';
    this.transactionHash = transactionHash;
    this.status = diagnostic.status;
    this.data = diagnostic.data;
    this.cause = diagnostic.cause;
    this.action = diagnostic.action;
    this.problemType = diagnostic.problemType;
    this.problem = parseProblem(diagnostic.data);
    this.observations = diagnostic.observations;
  }
}

// True when the node has not activated the /v2
// write surface. Callers in a migration window can
// fall back to the explicit legacyV1 namespace --
// but only by re-preparing the transaction, never
// by resubmitting the same signed bytes.
export function isNativeV2NotActive(
  error: unknown
): boolean {
  return (
    errorCodeOf(error) ===
    V2_ERROR_CODES.DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE
  );
}

// True when the node has disabled the legacy /v1
// write surface.
export function isLegacyWriteDisabled(
  error: unknown
): boolean {
  return (
    errorCodeOf(error) ===
    V2_ERROR_CODES.LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED
  );
}

// `serverHash` originates from a parsed HTTP
// response body -- the static `string` type on the
// caller's side does not guarantee the runtime shape.
// Anything that is not a pair of strings is treated
// as a mismatch (never a silent pass-through) so this
// stays fail-closed: the transaction was already
// admitted by the time this runs, and this path always
// throws TransactionHashMismatchError (`submitted:
// true`) to the caller.
export function assertTransactionHash(
  localHash: unknown,
  serverHash: unknown
): void {
  if (
    typeof localHash !== 'string' ||
    typeof serverHash !== 'string' ||
    localHash.toLowerCase() !==
      serverHash.toLowerCase()
  ) {
    throw new TransactionHashMismatchError(
      String(localHash),
      String(serverHash)
    );
  }
}
