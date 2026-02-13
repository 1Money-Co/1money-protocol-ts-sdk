import { createPreparedTx } from '../core';
import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';

import type { TokenBurnPayload } from '@/api/tokens/types';

export type TokenBurnUnsigned = Omit<
  TokenBurnPayload,
  'signature'
>;

export function prepareTokenBurnTx(
  unsigned: TokenBurnUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
    ])
  );

  return createPreparedTx<
    TokenBurnUnsigned,
    TokenBurnPayload
  >({
    kind: 'tokenBurn',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
