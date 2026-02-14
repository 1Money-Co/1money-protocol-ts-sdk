import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';

import type { TokenBurnAndBridgePayload } from '@/api/tokens/types';

export type TokenBurnAndBridgeUnsigned = Omit<
  TokenBurnAndBridgePayload,
  'signature'
>;

export function prepareTokenBurnAndBridgeTx(
  unsigned: TokenBurnAndBridgeUnsigned
) {
  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.address(unsigned.sender as `0x${string}`),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.uint(unsigned.destination_chain_id),
      rlpValue.string(
        unsigned.destination_address
      ),
      rlpValue.uint(unsigned.escrow_fee),
      rlpValue.string(unsigned.bridge_metadata),
      rlpValue.hex(unsigned.bridge_param as `0x${string}`),
    ])
  );

  return createPreparedTx<
    TokenBurnAndBridgeUnsigned,
    TokenBurnAndBridgePayload
  >({
    kind: 'tokenBurnAndBridge',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
