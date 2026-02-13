import { signAsync } from '@noble/secp256k1';
import { bytesToHex, hexToBytes } from 'viem';

import type { SignerAdapter, Hex } from './core';
import type { Signature } from '@/utils';

const DIGEST_HEX_RE = /^0x[0-9a-fA-F]{64}$/;

export function createPrivateKeySigner(
  privateKey: Hex
): SignerAdapter {
  const privateKeyBytes = hexToBytes(privateKey);

  return {
    signDigest: async (
      digest: Hex
    ): Promise<Signature> => {
      if (!DIGEST_HEX_RE.test(digest)) {
        throw new Error(
          `[1Money signing]: Invalid digest: ${digest}`
        );
      }

      const signature = await signAsync(
        hexToBytes(digest),
        privateKeyBytes,
        { lowS: true }
      );

      const compact = signature.toCompactRawBytes();
      const rBytes = compact.subarray(0, 32);
      const sBytes = compact.subarray(32, 64);

      return {
        r: bytesToHex(rBytes),
        s: bytesToHex(sBytes),
        v: signature.recovery,
      };
    },
  };
}
