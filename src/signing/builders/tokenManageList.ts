import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  validateChainAndNonce,
} from './validate';

import type { TokenManageListPayload } from '@/api/tokens/types';

export type TokenManageListUnsigned = Omit<
  TokenManageListPayload,
  'signature'
>;

export function prepareTokenManageListTx(unsigned: TokenManageListUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('address', unsigned.address);
  assertAddress('token', unsigned.token);

  return buildTx<TokenManageListUnsigned, TokenManageListPayload>({
    kind: 'tokenManageList',
    unsigned,
    payloadFields: [
      rlpValue.string(unsigned.action),
      rlpValue.address(unsigned.address as `0x${string}`),
      rlpValue.address(unsigned.token as `0x${string}`),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
