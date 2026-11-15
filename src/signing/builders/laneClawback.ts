import { rlpValue, type PlpPayload } from '@/utils';
import {
  assertAddress,
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertUintString
} from './validate';

import type { LaneClawbackPayload } from '@/api/tokens/types';

export type LaneClawbackUnsigned = LaneClawbackPayload;

/** The fixed, network-independent address of the VERIFY system token. */
export const VERIFY_TOKEN_ADDRESS =
  '0x0000000000000000000000000000000000000002';

export function isVerifyToken(token: string): boolean {
  return token.toLowerCase() === VERIFY_TOKEN_ADDRESS;
}

/**
 * Throws for the VERIFY token: the nodes refuse a lane clawback of
 * VERIFY for every signer, and its master claws VERIFY back with
 * the legacy clawback at the master's own nonce.
 */
export function refuseLaneClawbackOfVerify(
  token: string
): void {
  if (isVerifyToken(token)) {
    throw new Error(
      '[1Money SDK]: VERIFY has no lane clawback: its master claws it back with the legacy clawback'
    );
  }
}

export function validateLaneClawback(
  unsigned: LaneClawbackUnsigned
): void {
  assertPositiveInteger('chain_id', unsigned.chain_id);
  assertAddress('token', unsigned.token);
  assertAddress('holder', unsigned.holder);
  assertNonNegativeInteger(
    'from_nonce',
    unsigned.from_nonce
  );
  assertNonNegativeInteger(
    'reference_checkpoint',
    unsigned.reference_checkpoint
  );
  assertAddress('recipient', unsigned.recipient);
  assertUintString('value', unsigned.value);
  refuseLaneClawbackOfVerify(unsigned.token);
}

// The lane clawback carries no nonce of its signer, so its header
// is the chain ID alone; `from_nonce` is a business field.
export function laneClawbackHeaderFields(
  unsigned: LaneClawbackUnsigned
): PlpPayload[] {
  return [rlpValue.uint(unsigned.chain_id)];
}

export function laneClawbackPayloadFields(
  unsigned: LaneClawbackUnsigned
): PlpPayload[] {
  return [
    rlpValue.address(unsigned.token as `0x${string}`),
    rlpValue.address(unsigned.holder as `0x${string}`),
    rlpValue.uint(unsigned.from_nonce),
    rlpValue.uint(unsigned.reference_checkpoint),
    rlpValue.address(unsigned.recipient as `0x${string}`),
    rlpValue.uint(unsigned.value)
  ];
}
