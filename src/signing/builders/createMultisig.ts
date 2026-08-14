import { bytesToHex, hexToBytes } from 'viem';

import { rlpValue } from '@/utils';
import {
  assertPositiveIntegerAtMost,
  validateChainAndNonce
} from './validate';

import type { PlpPayload } from '@/utils';
import type { CreateMultiSigPayload } from '@/api/accounts/types';

export type CreateMultisigUnsigned =
  CreateMultiSigPayload;

const COMPRESSED_PUBKEY_BYTES = 33;
const MIN_SIGNERS = 2;
const MAX_SIGNERS = 20;
// MultiSigSigner.weight is a node-side u8; MultiSigAccountV1's
// threshold is a u16. Matches the bounds
// src/signing/v2/multisigAddress.ts already enforces when deriving
// the account address -- without this, e.g. weight: 256 would sign
// and submit, the node would reject it, and the caller would have no
// way to derive the address locally either.
const MAX_WEIGHT = 255;
const MAX_THRESHOLD = 0xffff;
// The node sums signer weights with checked u16 arithmetic and
// rejects threshold > total_weight (om-primitives
// MultiSigAccountV1::validate). Mirrored here -- and already
// mirrored in deriveMultisigAddress -- so a config this validator
// accepts is never one the node certainly rejects.
const MAX_TOTAL_WEIGHT = 0xffff;

// Structural validation only: 0x-hex of exactly 33 bytes. This
// layer deliberately does NOT check that the key is a point on
// the secp256k1 curve.
//
// Two reasons. The signing layer encodes whatever the caller
// signs, and the node rejects an unusable key at admission, so a
// bad key costs a rejected transaction and nothing more. And the
// frozen golden vectors use off-curve dummy keys (0x02 followed
// by 32 0x11 bytes) -- adding a curve check here would make the
// CreateMultiSig conformance vector impossible to reproduce.
//
// deriveMultisigAddress is the opposite case and DOES validate
// the curve point: it hands back an address someone may fund.
function pubkeyBytes(
  publicKey: string,
  index: number
): Uint8Array {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(publicKey)) {
    throw new Error(
      `[1Money SDK]: Invalid signers[${index}].public_key: ${publicKey}`
    );
  }
  const bytes = hexToBytes(
    publicKey as `0x${string}`
  );
  if (bytes.length !== COMPRESSED_PUBKEY_BYTES) {
    throw new Error(
      `[1Money SDK]: Invalid signers[${index}].public_key: must be ${COMPRESSED_PUBKEY_BYTES} bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

export function validateCreateMultisig(
  unsigned: CreateMultisigUnsigned
): void {
  validateChainAndNonce(unsigned);
  if (
    unsigned.signers.length < MIN_SIGNERS ||
    unsigned.signers.length > MAX_SIGNERS
  ) {
    throw new Error(
      `[1Money SDK]: Invalid signers: expected between ${MIN_SIGNERS} and ${MAX_SIGNERS}, got ${unsigned.signers.length}`
    );
  }
  assertPositiveIntegerAtMost(
    'threshold',
    unsigned.threshold,
    MAX_THRESHOLD
  );
  const seenKeys = new Set<string>();
  let totalWeight = 0;
  unsigned.signers.forEach((signer, index) => {
    const bytes = pubkeyBytes(
      signer.public_key,
      index
    );
    assertPositiveIntegerAtMost(
      `signers[${index}].weight`,
      signer.weight,
      MAX_WEIGHT
    );
    const key = bytesToHex(bytes);
    if (seenKeys.has(key)) {
      throw new Error(
        '[1Money SDK]: Invalid signers: duplicate public key'
      );
    }
    seenKeys.add(key);
    totalWeight += signer.weight;
    if (totalWeight > MAX_TOTAL_WEIGHT) {
      throw new Error(
        '[1Money SDK]: Invalid signers: total weight overflows u16'
      );
    }
  });
  if (unsigned.threshold > totalWeight) {
    throw new Error(
      `[1Money SDK]: Invalid threshold: ${unsigned.threshold} exceeds total signer weight ${totalWeight}`
    );
  }
}

// public_key is a bare Vec<u8> in the L1 payload, which the Rust
// encoder emits as a list of individually encoded single-byte
// integers -- NOT one 33-byte string. See
// native-v2-signing-spec section 3. The 33-byte pubkeys in a
// multisig authorization proof do use ordinary byte strings; this
// quirk is payload-local.
export function createMultisigPayloadFields(
  unsigned: CreateMultisigUnsigned
): PlpPayload[] {
  return [
    rlpValue.list(
      unsigned.signers.map((signer, index) =>
        rlpValue.list([
          rlpValue.byteList(
            pubkeyBytes(
              signer.public_key,
              index
            )
          ),
          rlpValue.uint(signer.weight)
        ])
      )
    ),
    rlpValue.uint(unsigned.threshold)
  ];
}

// serde serializes the Rust Vec<u8> as a JSON number array, not a
// hex string, so the wire body must match.
export function createMultisigWireFields(
  unsigned: CreateMultisigUnsigned
): Record<string, unknown> {
  return {
    chain_id: unsigned.chain_id,
    nonce: unsigned.nonce,
    signers: unsigned.signers.map(
      (signer, index) => ({
        public_key: Array.from(
          pubkeyBytes(signer.public_key, index)
        ),
        weight: signer.weight
      })
    ),
    threshold: unsigned.threshold
  };
}
