import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import { validateChainAndNonce, validateValueToken } from './validate';

import type { TokenBurnPayload } from '@/api/tokens/types';

export type TokenBurnUnsigned = Omit<TokenBurnPayload, 'signature'>;

export function validateTokenBurn(unsigned: TokenBurnUnsigned) {
  validateChainAndNonce(unsigned);
  validateValueToken(unsigned);
}

export function tokenBurnPayloadFields(
  unsigned: TokenBurnUnsigned
): PlpPayload[] {
  return [
    rlpValue.uint(unsigned.value),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];
}

export function prepareTokenBurnTx(unsigned: TokenBurnUnsigned) {
  validateTokenBurn(unsigned);

  return buildTx<TokenBurnUnsigned, TokenBurnPayload>({
    kind: 'tokenBurn',
    unsigned,
    payloadFields: tokenBurnPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
