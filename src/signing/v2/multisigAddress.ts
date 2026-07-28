import { Point } from '@noble/secp256k1';
import { bytesToHex, hexToBytes, keccak256 } from 'viem';

import type { ZeroXString } from '@/utils';
import type { MultiSigSigner } from '@/api/accounts/types';

// Domain separation tag for multisig address derivation
// (L1 DST_MULTISIG_ADDR_V1).
const DST_MULTISIG_ADDR_V1 = 'MULTISIG_V1';
const COMPRESSED_PUBKEY_BYTES = 33;
// The node sums signer weights with checked u16 arithmetic
// (om-primitives MultiSigAccountV1::validate).
const MAX_TOTAL_WEIGHT = 0xffff;

// Unlike the payload encoder, this module validates that each key
// is a real, canonically encoded point on secp256k1. It returns an
// address someone may send funds to, and an address derived from a
// key the node will reject is an address whose funds are
// unrecoverable. A merely-33-byte blob is not enough.
function assertCurvePoint(
  key: Uint8Array,
  index: number
): void {
  let canonical: Uint8Array;
  try {
    canonical = Point.fromHex(key).toRawBytes(true);
  } catch {
    throw new Error(
      `[1Money SDK]: Invalid signers[${index}].public_key: not a point on secp256k1`
    );
  }
  if (bytesToHex(canonical) !== bytesToHex(key)) {
    throw new Error(
      `[1Money SDK]: Invalid signers[${index}].public_key: not in canonical SEC1-compressed form`
    );
  }
}

function compareBytes(
  a: Uint8Array,
  b: Uint8Array
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

// Byte-for-byte identical to the address the node assigns at
// execution: keccak256("MULTISIG_V1" || sorted(pubkey || weight)
// || threshold_be_u16), truncated to the last 20 bytes. Pure, so
// it can be called before submitting the creation transaction.
export function deriveMultisigAddress(
  signers: MultiSigSigner[],
  threshold: number
): ZeroXString {
  if (signers.length === 0) {
    throw new Error(
      '[1Money SDK]: Invalid signers: must not be empty'
    );
  }
  if (
    !Number.isSafeInteger(threshold) ||
    threshold <= 0
  ) {
    throw new Error(
      `[1Money SDK]: Invalid threshold: ${threshold}`
    );
  }

  const sorted = signers
    .map((signer, index) => {
      const key = hexToBytes(
        signer.public_key as `0x${string}`
      );
      if (
        key.length !== COMPRESSED_PUBKEY_BYTES
      ) {
        throw new Error(
          `[1Money SDK]: Invalid signers[${index}].public_key: must be ${COMPRESSED_PUBKEY_BYTES} bytes, got ${key.length}`
        );
      }
      assertCurvePoint(key, index);
      if (
        !Number.isSafeInteger(signer.weight) ||
        signer.weight <= 0 ||
        signer.weight > 255
      ) {
        throw new Error(
          `[1Money SDK]: Invalid signers[${index}].weight: ${signer.weight}`
        );
      }
      return { key, weight: signer.weight };
    })
    .sort((a, b) => compareBytes(a.key, b.key));

  let totalWeight = 0;
  sorted.forEach((signer, index) => {
    if (
      index > 0 &&
      compareBytes(
        signer.key,
        sorted[index - 1].key
      ) === 0
    ) {
      throw new Error(
        '[1Money SDK]: Invalid signers: duplicate public key'
      );
    }
    totalWeight += signer.weight;
    if (totalWeight > MAX_TOTAL_WEIGHT) {
      throw new Error(
        '[1Money SDK]: Invalid signers: total weight overflows u16'
      );
    }
  });

  if (threshold > totalWeight) {
    throw new Error(
      `[1Money SDK]: Invalid threshold: ${threshold} exceeds total signer weight ${totalWeight}`
    );
  }

  const tag = new TextEncoder().encode(
    DST_MULTISIG_ADDR_V1
  );
  const preimage = new Uint8Array(
    tag.length +
      sorted.length *
        (COMPRESSED_PUBKEY_BYTES + 1) +
      2
  );
  let offset = 0;
  preimage.set(tag, offset);
  offset += tag.length;
  sorted.forEach(signer => {
    preimage.set(signer.key, offset);
    offset += signer.key.length;
    preimage[offset] = signer.weight;
    offset += 1;
  });
  preimage[offset] = (threshold >> 8) & 0xff;
  preimage[offset + 1] = threshold & 0xff;

  const hash = keccak256(preimage);
  return `0x${hash.slice(26)}` as ZeroXString;
}
