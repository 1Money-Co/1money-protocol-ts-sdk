import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  validateChainAndNonce,
  validateValueToken,
} from './validate';

import type { TokenBurnPayload } from '@/api/tokens/types';

export type TokenBurnUnsigned = Omit<TokenBurnPayload, 'signature'>;

export function prepareTokenBurnTx(unsigned: TokenBurnUnsigned) {
  validateChainAndNonce(unsigned);
  validateValueToken(unsigned);

  return buildTx<TokenBurnUnsigned, TokenBurnPayload>({
    kind: 'tokenBurn',
    unsigned,
    payloadFields: [
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
