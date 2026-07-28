import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import { assertAddress, validateChainAndNonce } from './validate';

import type { TokenPausePayload } from '@/api/tokens/types';

export type TokenPauseUnsigned = Omit<TokenPausePayload, 'signature'>;

export function validateTokenPause(unsigned: TokenPauseUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);
}

export function tokenPausePayloadFields(
  unsigned: TokenPauseUnsigned
): PlpPayload[] {
  return [
    rlpValue.string(unsigned.action),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];
}

export function prepareTokenPauseTx(unsigned: TokenPauseUnsigned) {
  validateTokenPause(unsigned);

  return buildTx<TokenPauseUnsigned, TokenPausePayload>({
    kind: 'tokenPause',
    unsigned,
    payloadFields: tokenPausePayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
