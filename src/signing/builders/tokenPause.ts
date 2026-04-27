import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  validateChainAndNonce,
} from './validate';

import type { TokenPausePayload } from '@/api/tokens/types';

export type TokenPauseUnsigned = Omit<TokenPausePayload, 'signature'>;

export function prepareTokenPauseTx(unsigned: TokenPauseUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);

  return buildTx<TokenPauseUnsigned, TokenPausePayload>({
    kind: 'tokenPause',
    unsigned,
    payloadFields: [
      rlpValue.string(unsigned.action),
      rlpValue.address(unsigned.token as `0x${string}`),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
