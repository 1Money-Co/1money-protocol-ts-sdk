import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';

import type { TokenBridgeAndMintPayload } from '@/api/tokens/types';

export type TokenBridgeAndMintUnsigned = Omit<
  TokenBridgeAndMintPayload,
  'signature'
>;

export function prepareTokenBridgeAndMintTx(
  unsigned: TokenBridgeAndMintUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.address(unsigned.recipient as `0x${string}`),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.uint(unsigned.source_chain_id),
      rlpValue.string(unsigned.source_tx_hash),
      rlpValue.string(unsigned.bridge_metadata),
    ])
  );

  return createPreparedTx<
    TokenBridgeAndMintUnsigned,
    TokenBridgeAndMintPayload
  >({
    kind: 'tokenBridgeAndMint',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
