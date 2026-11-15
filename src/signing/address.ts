import {
  Signature as Secp256k1Signature,
  getPublicKey
} from '@noble/secp256k1';
import { getAddress, hexToBytes, keccak256 } from 'viem';

import { toParityV } from './v2/authorization';

import type { Signature, ZeroXString } from '@/utils';

// The last 20 bytes of the keccak-256 of the uncompressed public
// key, without its 0x04 prefix.
function addressOfPublicKey(uncompressed: Uint8Array): ZeroXString {
  const hash = keccak256(uncompressed.subarray(1));
  return getAddress(`0x${hash.slice(-40)}`);
}

export function addressOfPrivateKey(
  privateKey: Uint8Array
): ZeroXString {
  return addressOfPublicKey(getPublicKey(privateKey, false));
}

// Synchronous, with no dynamic import: viem's recoverAddress loads
// its curve library with import(), which the UMD bundle cannot hold.
export function recoverSignerAddress(
  digest: ZeroXString,
  signature: Signature
): ZeroXString {
  const point = new Secp256k1Signature(
    BigInt(signature.r),
    BigInt(signature.s),
    toParityV(signature)
  ).recoverPublicKey(hexToBytes(digest));
  return addressOfPublicKey(point.toBytes(false));
}
