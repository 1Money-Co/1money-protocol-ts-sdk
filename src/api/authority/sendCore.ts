import { prepareTransactionV2 } from '@/signing/v2';
import { submitAuthorized } from '../submit';
import {
  authorityEnvelope,
  readEnvelopeMode
} from './envelopeMode';

import type { Hash } from '../types';
import type { SignerAdapter } from '@/signing/core';
import type {
  AuthorizedTxV2,
  OperationName,
  OperationUnsignedMap
} from '@/signing/v2';
import type { Memo } from '@/utils';

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

export async function submit(
  authorized: AuthorizedTxV2
): Promise<AuthorizedTxV2> {
  await submitAuthorized<Hash>(
    authorized,
    authorized.operation
  );
  return authorized;
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
