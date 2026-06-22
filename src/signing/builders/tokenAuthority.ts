import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  assertOptionalUintString,
  validateChainAndNonce,
} from './validate';

import type { TokenAuthorityPayload } from '@/api/tokens/types';

export type TokenAuthorityUnsigned = Omit<TokenAuthorityPayload, 'signature'>;

export function prepareTokenAuthorityTx(unsigned: TokenAuthorityUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('authority_address', unsigned.authority_address);
  assertAddress('token', unsigned.token);
  assertOptionalUintString('value', unsigned.value);

  const payloadFields: PlpPayload[] = [
    rlpValue.string(unsigned.action),
    rlpValue.string(unsigned.authority_type),
    rlpValue.address(unsigned.authority_address as `0x${string}`),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];
  if (unsigned.value !== undefined) {
    payloadFields.push(rlpValue.uint(unsigned.value));
  }

  return buildTx<TokenAuthorityUnsigned, TokenAuthorityPayload>({
    kind: 'tokenAuthority',
    unsigned,
    payloadFields,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
