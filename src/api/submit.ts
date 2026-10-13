import { post } from '@/client';
import { classifySubmitResponse } from './classify';
import {
  assertTransactionHash,
  TransactionLockedError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from './errors';

import type { SubmitOutcome } from './classify';
import type {
  AuthorizedTxV2,
  OperationName
} from '@/signing/v2';

// POST an authorized v2 transaction and classify the
// answer (src/api/classify.ts). Never throws for a node
// answer.
//
// `post()`'s promise wrapper RESOLVES instead of REJECTS whenever the
// caller configured a global `onError`/`onTimeout` via
// `setInitConfig` (see core.ts's `existedHandler.error`/`.timeout`
// branches) -- so the exact same ParsedError-shaped value can arrive
// either as a caught rejection or as a "successful" resolution.
// Both are classified the same way instead of trusting
// resolve-vs-reject to mean success-vs-failure.
export async function sendAuthorized(
  authorized: AuthorizedTxV2
): Promise<SubmitOutcome> {
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
  return classifySubmitResponse(
    response,
    authorized.transactionHash
  );
}

// Submit and map the outcome to a value or an error:
// - accepted: verify the hash, fail-closed (see
//   TransactionHashMismatchError), and return the
//   response.
// - rejected: TransactionSubmissionError (submitted:
//   false).
// - locked: TransactionLockedError (submitted: true).
// - unknown: TransactionOutcomeUnknownError (submitted:
//   'unknown').
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

  const outcome = await sendAuthorized(authorized);
  switch (outcome.kind) {
    case 'accepted':
      assertTransactionHash(
        authorized.transactionHash,
        outcome.serverHash
      );
      return outcome.response as T;
    case 'rejected':
      throw new TransactionSubmissionError(
        outcome.status,
        outcome.data,
        outcome.nodeMessage,
        {
          action: outcome.action,
          problemType: outcome.problemType
        }
      );
    case 'locked':
      throw new TransactionLockedError(
        authorized.transactionHash,
        {
          status: outcome.status,
          data: outcome.data,
          problemType: outcome.problemType
        }
      );
    case 'unknown':
      throw new TransactionOutcomeUnknownError(
        authorized.transactionHash,
        {
          status: outcome.status,
          data: outcome.data,
          cause: outcome.cause,
          action: outcome.action,
          problemType: outcome.problemType
        }
      );
  }
}
