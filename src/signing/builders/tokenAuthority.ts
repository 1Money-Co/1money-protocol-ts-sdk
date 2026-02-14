import type { PlpPayload } from '@/utils';
import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';

import type { TokenAuthorityPayload } from '@/api/tokens/types';

export type TokenAuthorityUnsigned = Omit<
  TokenAuthorityPayload,
  'signature'
>;

export function prepareTokenAuthorityTx(
  unsigned: TokenAuthorityUnsigned
) {
  const values: PlpPayload[] = [
    rlpValue.uint(unsigned.chain_id),
    rlpValue.uint(unsigned.nonce),
    rlpValue.string(unsigned.action),
    rlpValue.string(unsigned.authority_type),
    rlpValue.address(unsigned.authority_address as `0x${string}`),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];

  if (unsigned.value !== undefined) {
    values.push(rlpValue.uint(unsigned.value));
  }

  const rlpBytes = encodeRlpPayload(rlpValue.list(values));

  return createPreparedTx<
    TokenAuthorityUnsigned,
    TokenAuthorityPayload
  >({
    kind: 'tokenAuthority',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
