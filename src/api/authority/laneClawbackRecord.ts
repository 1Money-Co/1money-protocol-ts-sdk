import {
  OPERATION_REGISTRY,
  prepareTransactionV2
} from '@/signing/v2';

import type { LaneClawbackPayload } from '../tokens/types';
import type { AuthorizedTxV2 } from '@/signing/v2';
import type { Memo, Signature } from '@/utils';

const PAYLOAD_KEYS = [
  'chain_id',
  'token',
  'holder',
  'from_nonce',
  'reference_checkpoint',
  'recipient',
  'value'
] as const;

const REQUEST_KEYS: readonly string[] = [
  ...PAYLOAD_KEYS,
  'memo',
  'authorization'
];

/** A stored lane clawback whose request matches its hash. */
export interface LaneClawbackRecord {
  payload: LaneClawbackPayload;
  memo: Memo;
  transactionHash: string;
}

function refuse(reason: string): never {
  throw new Error(
    `[1Money SDK]: Not a valid signed lane clawback: ${reason}`
  );
}

function memoOf(value: unknown): Memo {
  const memo = value as Record<string, unknown> | null;
  if (
    typeof memo !== 'object' ||
    memo === null ||
    !['type', 'format', 'data'].every(
      key => typeof memo[key] === 'string'
    )
  ) {
    refuse('its memo is missing or malformed');
  }
  return {
    type: memo.type as string,
    format: memo.format as string,
    data: memo.data as string
  };
}

function signatureOf(value: unknown): Signature {
  const authorization = value as {
    type?: unknown;
    signature?: Record<string, unknown>;
  } | null;
  const signature = authorization?.signature;
  if (
    authorization?.type !== 'single_secp256k1' ||
    typeof signature?.r !== 'string' ||
    typeof signature?.s !== 'string' ||
    (signature?.v !== 0 && signature?.v !== 1)
  ) {
    refuse('its authorization is not one secp256k1 signature');
  }
  return {
    r: signature.r as Signature['r'],
    s: signature.s as Signature['s'],
    v: signature.v as 0 | 1
  };
}

function recomputedHash(
  payload: LaneClawbackPayload,
  memo: Memo,
  signature: Signature
): string {
  try {
    return prepareTransactionV2('laneClawback', payload, {
      memo
    }).authorize(signature).transactionHash;
  } catch (error) {
    return refuse(
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Check a stored signed lane clawback before anything reads or signs
 * from it. The hash is computed again from the request (payload,
 * memo and signature): a record whose hash and request belong to two
 * clawbacks would read one clawback's fate on the other's lane.
 * Throws for another operation, an unknown member, a payload the
 * builder refuses, or a hash that does not match.
 */
export function laneClawbackRecordOf(
  stored: AuthorizedTxV2
): LaneClawbackRecord {
  const request = stored?.request as Record<string, unknown>;
  if (
    stored?.operation !== 'laneClawback' ||
    stored.path !== OPERATION_REGISTRY.laneClawback.pathV2 ||
    typeof request !== 'object' ||
    request === null
  ) {
    refuse('another operation');
  }
  const unknown = Object.keys(request).filter(
    key => !REQUEST_KEYS.includes(key)
  );
  if (unknown.length > 0) {
    refuse(`unknown members ${unknown.join(', ')}`);
  }
  const payload = Object.fromEntries(
    PAYLOAD_KEYS.map(key => [key, request[key]])
  ) as unknown as LaneClawbackPayload;
  const memo = memoOf(request.memo);
  const hash = recomputedHash(
    payload,
    memo,
    signatureOf(request.authorization)
  );
  if (
    typeof stored.transactionHash !== 'string' ||
    hash.toLowerCase() !== stored.transactionHash.toLowerCase()
  ) {
    refuse('its hash does not match its request');
  }
  return { payload, memo, transactionHash: hash };
}
