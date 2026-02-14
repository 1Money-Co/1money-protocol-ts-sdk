import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';

import type { TokenMintPayload } from '@/api/tokens/types';

export type TokenMintUnsigned = Omit<
  TokenMintPayload,
  'signature'
>;

export function prepareTokenMintTx(
  unsigned: TokenMintUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.address(
        unsigned.recipient as `0x${string}`
      ),
      rlpValue.uint(unsigned.value),
      rlpValue.address(
        unsigned.token as `0x${string}`
      ),
    ])
  );

  return createPreparedTx<
    TokenMintUnsigned,
    TokenMintPayload
  >({
    kind: 'tokenMint',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
