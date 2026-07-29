import { post } from '@/client';
import {
  assertTransactionHash,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from './errors';

import type {
  AuthorizedTxV2,
  OperationName
} from '@/signing/v2';

function extractHash(
  value: unknown
): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return undefined;
  }
  const hash = (value as { hash?: unknown }).hash;
  return typeof hash === 'string'
    ? hash
    : undefined;
}

// A value shaped like ParsedError (src/client/core.ts): a numeric
// HTTP status plus the response body the node actually sent back
// (`data`). Requiring `data` to be present -- not just a numeric
// `status` -- keeps a resolved client-side timeout out of this
// bucket: parseError() defaults a timeout's status to 500 too, but a
// timeout never has a `data`, since no response body ever arrived.
// That case is genuinely ambiguous and belongs in the "unknown"
// outcome below, not "refused".
function isRefusedResponse(
  value: unknown
): value is {
  status: number;
  message?: string;
  data?: unknown;
} {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }
  const v = value as {
    status?: unknown;
    data?: unknown;
  };
  return (
    typeof v.status === 'number' &&
    v.data !== undefined &&
    extractHash(value) === undefined
  );
}

// POST an authorized v2 transaction and classify the outcome into
// three, deliberately distinct cases:
//
// 1. Hash-bearing success -- the node returned a string `hash`.
//    Verify it, fail-closed, against the locally computed
//    transactionHash. See TransactionHashMismatchError for why a
//    mismatch here is not retryable.
// 2. Refused -- the node rejected the write before admission (an
//    HTTP error with a response body). NOT submitted; safe to retry
//    once the underlying cause is fixed. See
//    TransactionSubmissionError.
// 3. Unknown -- neither of the above (e.g. a timeout, a network
//    error, or a 2xx body with no hash). The node may or may not
//    have admitted the transaction; do not guess either way. See
//    TransactionOutcomeUnknownError.
//
// `post()`'s promise wrapper RESOLVES instead of REJECTS whenever the
// caller configured a global `onError`/`onTimeout` via
// `setInitConfig` (see core.ts's `existedHandler.error`/`.timeout`
// branches) -- so the exact same ParsedError-shaped value can arrive
// either as a caught rejection or as a "successful" resolution.
// Both are routed through the classification below instead of
// trusting resolve-vs-reject to mean success-vs-failure, which is
// what let a refused write masquerade as a submitted one.
export async function submitAuthorized<
  T extends { hash: string }
>(
  authorized: AuthorizedTxV2,
  expectedOperation: OperationName
): Promise<T> {
  if (authorized.operation !== expectedOperation) {
    throw new Error(
      `[1Money SDK]: Expected a "${expectedOperation}" authorization but received "${authorized.operation}". Refusing to submit -- prepare and authorize the transaction with the matching TransactionBuilder method.`
    );
  }

  let response: unknown;
  try {
    response = await post<'custom', unknown>(
      authorized.path,
      authorized.request,
      { withCredentials: false }
    );
  } catch (caught) {
    response = caught;
  }

  const hash = extractHash(response);
  if (hash !== undefined) {
    assertTransactionHash(
      authorized.transactionHash,
      hash
    );
    return response as T;
  }

  if (isRefusedResponse(response)) {
    throw new TransactionSubmissionError(
      response.status,
      response.data,
      typeof response.message === 'string'
        ? response.message
        : 'the node rejected the request'
    );
  }

  throw new TransactionOutcomeUnknownError(
    authorized.transactionHash
  );
}
