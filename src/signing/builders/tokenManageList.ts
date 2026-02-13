import { createPreparedTx } from '../core';
import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';

import type { TokenManageListPayload } from '@/api/tokens/types';

export type TokenManageListUnsigned = Omit<
  TokenManageListPayload,
  'signature'
>;

export function prepareTokenManageListTx(
  unsigned: TokenManageListUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.string(unsigned.action),
      rlpValue.address(unsigned.address as `0x${string}`),
      rlpValue.address(unsigned.token as `0x${string}`),
    ])
  );

  return createPreparedTx<
    TokenManageListUnsigned,
    TokenManageListPayload
  >({
    kind: 'tokenManageList',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
