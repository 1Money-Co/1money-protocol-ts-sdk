import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  assertPositiveInteger,
  assertUintString,
  validateChainAndNonce,
  validateValueToken,
} from './validate';

import type { TokenBurnAndBridgePayload } from '@/api/tokens/types';

export type TokenBurnAndBridgeUnsigned = Omit<
  TokenBurnAndBridgePayload,
  'signature'
>;

export function prepareTokenBurnAndBridgeTx(
  unsigned: TokenBurnAndBridgeUnsigned
) {
  validateChainAndNonce(unsigned);
  assertAddress('sender', unsigned.sender);
  validateValueToken(unsigned);
  assertPositiveInteger(
    'destination_chain_id',
    unsigned.destination_chain_id
  );
  assertAddress('destination_address', unsigned.destination_address);
  assertUintString('escrow_fee', unsigned.escrow_fee);

  return buildTx<TokenBurnAndBridgeUnsigned, TokenBurnAndBridgePayload>({
    kind: 'tokenBurnAndBridge',
    unsigned,
    payloadFields: [
      rlpValue.address(unsigned.sender as `0x${string}`),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.uint(unsigned.destination_chain_id),
      rlpValue.string(unsigned.destination_address),
      rlpValue.uint(unsigned.escrow_fee),
      rlpValue.string(unsigned.bridge_metadata),
      rlpValue.hex(unsigned.bridge_param as `0x${string}`),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
