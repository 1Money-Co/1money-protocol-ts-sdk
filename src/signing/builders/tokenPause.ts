import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';

import type { TokenPausePayload } from '@/api/tokens/types';

export type TokenPauseUnsigned = Omit<
  TokenPausePayload,
  'signature'
>;

export function prepareTokenPauseTx(
  unsigned: TokenPauseUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.string(unsigned.action),
      rlpValue.address(unsigned.token as `0x${string}`),
    ])
  );

  return createPreparedTx<
    TokenPauseUnsigned,
    TokenPausePayload
  >({
    kind: 'tokenPause',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
