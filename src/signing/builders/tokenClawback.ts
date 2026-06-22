import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { TokenClawbackPayload } from '@/api/tokens/types';

export type TokenClawbackUnsigned = Omit<TokenClawbackPayload, 'signature'>;

export function prepareTokenClawbackTx(unsigned: TokenClawbackUnsigned) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);
  assertAddress('from', unsigned.from);

  return buildTx<TokenClawbackUnsigned, TokenClawbackPayload>({
    kind: 'tokenClawback',
    unsigned,
    payloadFields: [
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.address(unsigned.from as `0x${string}`),
      rlpValue.address(unsigned.recipient as `0x${string}`),
      rlpValue.uint(unsigned.value),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
