import { post } from '@/client';
import { OPERATION_REGISTRY } from '@/signing/v2';
import { laneClawbackRecordOf } from './authority/laneClawbackRecord';
import {
  classifySubmitResponse,
  isNonceUsed
} from './classify';
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

// The one copy that every check, send and error of a submission
// uses. The caller may change or reuse its object while a send
// waits, and a stored record can pair one operation's label with
// another's route: the route must be the label's, so every guard
// that reads the label also covers what is sent.
export function signedCopy(
  authorized: AuthorizedTxV2
): AuthorizedTxV2 {
  const operation = authorized?.operation;
  const route = Object.prototype.hasOwnProperty.call(
    OPERATION_REGISTRY,
    operation
  )
    ? OPERATION_REGISTRY[operation].pathV2
    : undefined;
  if (route === undefined || authorized.path !== route) {
    throw new Error(
      `[1Money SDK]: The route ${String(authorized?.path)} is not the route of a "${String(operation)}" authorization. Refusing to submit -- prepare and authorize the transaction with the matching TransactionBuilder method.`
    );
  }
  return {
    operation,
    path: route,
    request: JSON.parse(
      JSON.stringify(authorized.request)
    ) as AuthorizedTxV2['request'],
    transactionHash: authorized.transactionHash
  };
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
// A lane clawback is checked against its hash before the POST: a
// stored record can pair one clawback's hash with another's
// request, and the node would admit the request.
export async function submitAuthorized<
  T extends { hash: string }
>(
  stored: AuthorizedTxV2,
  expectedOperation: OperationName
): Promise<T> {
  const authorized = signedCopy(stored);
  if (authorized.operation !== expectedOperation) {
    throw new Error(
      `[1Money SDK]: Expected a "${expectedOperation}" authorization but received "${authorized.operation}". Refusing to submit -- prepare and authorize the transaction with the matching TransactionBuilder method.`
    );
  }
  if (authorized.operation === 'laneClawback') {
    laneClawbackRecordOf(authorized);
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
          problemType: outcome.problemType,
          nonceUsed: isNonceUsed(outcome)
        }
      );
    case 'locked':
      throw new TransactionLockedError(
        authorized.transactionHash,
        {
          status: outcome.status,
          data: outcome.data,
          problemType: outcome.problemType,
          nonceUsed: isNonceUsed(outcome),
          authorized
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
          problemType: outcome.problemType,
          nonceUsed: isNonceUsed(outcome),
          authorized
        }
      );
  }
}
