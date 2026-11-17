import { recoverSignerAddress } from '@/signing/address';
import { prepareTransactionV2 } from '@/signing/v2';
import { submitAuthorized } from '../submit';
import {
  authorityEnvelope,
  readEnvelopeMode
} from './envelopeMode';
import { isReferenceNotReady } from './refusals';

import type { Hash } from '../types';
import type { SignerAdapter } from '@/signing/core';
import type {
  AuthorizedTxV2,
  OperationName,
  OperationUnsignedMap
} from '@/signing/v2';
import type { Memo } from '@/utils';

const DEFAULT_REFERENCE_RETRY_DELAY_MS = 1_000;

/** What onSigned is told about a signed transaction. */
export interface SignedContext {
  /**
   * The transaction this one supersedes. The node refused it at
   * admission, and it had no effect. Never send it again: at most
   * one of the two can execute, and only this one is tracked.
   * Missing when a new signature has the same hash as the last one:
   * the same transaction stays active.
   */
  replaces?: AuthorizedTxV2;
}

/**
 * Called with each signed transaction before it is sent. Persist it
 * before you return: a crash between the send and the store would
 * lose the only record of a transaction that can execute. A
 * rejection stops the send.
 */
export type OnSigned = (
  authorized: AuthorizedTxV2,
  context: SignedContext
) => Promise<void> | void;

// Hands each new signature of one intent to onSigned, with the
// signature it supersedes. A retry with the same checkpoint and
// nonce signs the same bytes (RFC 6979 signatures are
// deterministic), and a journal that retires `replaces` would then
// retire the one active record.
export function signedRecorder(
  onSigned: OnSigned | undefined
): (authorized: AuthorizedTxV2) => Promise<void> {
  let last: AuthorizedTxV2 | undefined;
  return async authorized => {
    const supersedes =
      last !== undefined &&
      last.transactionHash.toLowerCase() !==
        authorized.transactionHash.toLowerCase();
    await onSigned?.(
      authorized,
      supersedes ? { replaces: last } : {}
    );
    last = authorized;
  };
}

export async function sign<K extends OperationName>(
  operation: K,
  unsigned: OperationUnsignedMap[K],
  signer: SignerAdapter,
  memo?: Memo
): Promise<AuthorizedTxV2> {
  const prepared = prepareTransactionV2(operation, unsigned, {
    memo
  });
  return prepared.authorize(
    await signer.signDigest(prepared.signingHash)
  );
}

// The signer's address comes from its own signature, never from a
// value the caller passes.
export async function signRecovering<K extends OperationName>(
  operation: K,
  unsigned: OperationUnsignedMap[K],
  signer: SignerAdapter,
  memo?: Memo
): Promise<{ authorized: AuthorizedTxV2; signerAddress: string }> {
  const prepared = prepareTransactionV2(operation, unsigned, {
    memo
  });
  const signature = await signer.signDigest(prepared.signingHash);
  // authorize() refuses any v but 0 or 1 before the recovery reads it.
  const authorized = prepared.authorize(signature);
  const signerAddress = recoverSignerAddress(
    prepared.signingHash,
    signature
  );
  return { authorized, signerAddress };
}

export async function submit(
  authorized: AuthorizedTxV2
): Promise<AuthorizedTxV2> {
  await submitAuthorized<Hash>(
    authorized,
    authorized.operation
  );
  return authorized;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Signs, records and sends. One more signature after a short wait
// when the node refused the reference of the send as not committed
// or as not holding the token. Either refusal had no effect, so the
// second signature cannot make two transactions: they share a nonce
// (or a holder slot), or the slot of the first has passed. Only the
// send's own refusal counts: an error of the signer or of `record`
// stops the send, whatever it carries. A second refusal is
// returned: a token missing at the reference does not show it does
// not exist.
export async function sendWithReferenceRetry(
  signFresh: () => Promise<AuthorizedTxV2>,
  record: (authorized: AuthorizedTxV2) => Promise<void>,
  delayMs = DEFAULT_REFERENCE_RETRY_DELAY_MS
): Promise<AuthorizedTxV2> {
  const signAndRecord = async () => {
    const authorized = await signFresh();
    await record(authorized);
    return authorized;
  };
  const first = await signAndRecord();
  try {
    return await submit(first);
  } catch (error) {
    if (!isReferenceNotReady(error)) throw error;
  }
  await wait(delayMs);
  return submit(await signAndRecord());
}

// After a retired refusal: resolves once the node reports
// `settled`; otherwise rethrows the refusal, or throws the mode's
// error, so that the caller tries again later.
export async function settledAfterRetirement(
  refusal: unknown
): Promise<void> {
  const envelope = authorityEnvelope(await readEnvelopeMode());
  if (envelope === 'legacy') throw refusal;
}
