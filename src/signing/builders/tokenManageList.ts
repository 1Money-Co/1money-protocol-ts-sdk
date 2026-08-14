import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import { assertAddress, validateChainAndNonce } from './validate';

import type { TokenManageListPayload } from '@/api/tokens/types';

export type TokenManageListUnsigned = Omit<
  TokenManageListPayload,
  'signature'
>;

export function validateTokenManageList(unsigned: TokenManageListUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('address', unsigned.address);
  assertAddress('token', unsigned.token);
}

export function tokenManageListPayloadFields(
  unsigned: TokenManageListUnsigned
): PlpPayload[] {
  return [
    rlpValue.string(unsigned.action),
    rlpValue.address(unsigned.address as `0x${string}`),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];
}

export function prepareTokenManageListTx(unsigned: TokenManageListUnsigned) {
  validateTokenManageList(unsigned);

  return buildTx<TokenManageListUnsigned, TokenManageListPayload>({
    kind: 'tokenManageList',
    unsigned,
    payloadFields: tokenManageListPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
