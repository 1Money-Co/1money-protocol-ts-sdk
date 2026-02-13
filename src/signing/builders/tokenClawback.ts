import { createPreparedTx } from '../core';
import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';

import type {
  TokenClawbackPayload,
} from '@/api/tokens/types';

export type TokenClawbackUnsigned =
  Omit<TokenClawbackPayload, 'signature'>;

export function prepareTokenClawbackTx(
  unsigned: TokenClawbackUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.address(unsigned.from as `0x${string}`),
      rlpValue.address(
        unsigned.recipient as `0x${string}`
      ),
      rlpValue.uint(unsigned.value),
    ])
  );

  return createPreparedTx<
    TokenClawbackUnsigned,
    TokenClawbackPayload
  >({
    kind: 'tokenClawback',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
