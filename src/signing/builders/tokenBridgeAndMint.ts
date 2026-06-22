import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertPositiveInteger,
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { TokenBridgeAndMintPayload } from '@/api/tokens/types';

export type TokenBridgeAndMintUnsigned = Omit<
  TokenBridgeAndMintPayload,
  'signature'
>;

export function prepareTokenBridgeAndMintTx(
  unsigned: TokenBridgeAndMintUnsigned
) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);
  assertPositiveInteger('source_chain_id', unsigned.source_chain_id);

  return buildTx<TokenBridgeAndMintUnsigned, TokenBridgeAndMintPayload>({
    kind: 'tokenBridgeAndMint',
    unsigned,
    payloadFields: [
      rlpValue.address(unsigned.recipient as `0x${string}`),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.uint(unsigned.source_chain_id),
      rlpValue.string(unsigned.source_tx_hash),
      rlpValue.string(unsigned.bridge_metadata),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
