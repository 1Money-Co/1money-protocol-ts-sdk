import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { TokenMintPayload } from '@/api/tokens/types';

export type TokenMintUnsigned = Omit<TokenMintPayload, 'signature'>;

export function prepareTokenMintTx(unsigned: TokenMintUnsigned) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);

  return buildTx<TokenMintUnsigned, TokenMintPayload>({
    kind: 'tokenMint',
    unsigned,
    payloadFields: [
      rlpValue.address(unsigned.recipient as `0x${string}`),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
