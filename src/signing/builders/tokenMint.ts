import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import {
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { TokenMintPayload } from '@/api/tokens/types';

export type TokenMintUnsigned = Omit<TokenMintPayload, 'signature'>;

export function validateTokenMint(unsigned: TokenMintUnsigned) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);
}

export function tokenMintPayloadFields(
  unsigned: TokenMintUnsigned
): PlpPayload[] {
  return [
    rlpValue.address(unsigned.recipient as `0x${string}`),
    rlpValue.uint(unsigned.value),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];
}

export function prepareTokenMintTx(unsigned: TokenMintUnsigned) {
  validateTokenMint(unsigned);

  return buildTx<TokenMintUnsigned, TokenMintPayload>({
    kind: 'tokenMint',
    unsigned,
    payloadFields: tokenMintPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
