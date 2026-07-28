import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { TokenClawbackPayload } from '@/api/tokens/types';

export type TokenClawbackUnsigned = Omit<TokenClawbackPayload, 'signature'>;

export function validateTokenClawback(unsigned: TokenClawbackUnsigned) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);
  assertAddress('from', unsigned.from);
}

export function tokenClawbackPayloadFields(
  unsigned: TokenClawbackUnsigned
): PlpPayload[] {
  return [
    rlpValue.address(unsigned.token as `0x${string}`),
    rlpValue.address(unsigned.from as `0x${string}`),
    rlpValue.address(unsigned.recipient as `0x${string}`),
    rlpValue.uint(unsigned.value),
  ];
}

export function prepareTokenClawbackTx(unsigned: TokenClawbackUnsigned) {
  validateTokenClawback(unsigned);

  return buildTx<TokenClawbackUnsigned, TokenClawbackPayload>({
    kind: 'tokenClawback',
    unsigned,
    payloadFields: tokenClawbackPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
