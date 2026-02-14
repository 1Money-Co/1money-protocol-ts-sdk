import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';

import type { TokenIssuePayload } from '@/api/tokens/types';

export type TokenIssueUnsigned = Omit<
  TokenIssuePayload,
  'signature'
>;

export function prepareTokenIssueTx(
  unsigned: TokenIssueUnsigned
) {
  const clawbackEnabled =
    unsigned.clawback_enabled ?? true;

  const unsignedWithDefaults: TokenIssueUnsigned = {
    ...unsigned,
    clawback_enabled: clawbackEnabled,
  };

  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsignedWithDefaults.chain_id),
      rlpValue.uint(unsignedWithDefaults.nonce),
      rlpValue.string(unsignedWithDefaults.symbol),
      rlpValue.string(unsignedWithDefaults.name),
      rlpValue.uint(unsignedWithDefaults.decimals),
      rlpValue.address(
        unsignedWithDefaults.master_authority as `0x${string}`
      ),
      rlpValue.bool(unsignedWithDefaults.is_private),
      rlpValue.bool(clawbackEnabled),
    ])
  );

  return createPreparedTx<
    TokenIssueUnsigned,
    TokenIssuePayload
  >({
    kind: 'tokenIssue',
    unsigned: unsignedWithDefaults,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
