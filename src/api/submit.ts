import { post } from '@/client';
import { assertTransactionHash } from './errors';

import type { AuthorizedTxV2 } from '@/signing/v2';

// POST an authorized v2 transaction and verify, fail-closed, that
// the node's hash matches the locally computed one. See
// TransactionHashMismatchError for why a mismatch is not
// retryable.
export async function submitAuthorized<
  T extends { hash: string }
>(authorized: AuthorizedTxV2): Promise<T> {
  const response = await post<
    'custom',
    { hash: string }
  >(authorized.path, authorized.request, {
    withCredentials: false
  });
  assertTransactionHash(
    authorized.transactionHash,
    response.hash
  );
  return response as T;
}
