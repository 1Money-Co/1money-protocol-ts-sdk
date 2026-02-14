import { encode as rlpEncode } from '@ethereumjs/rlp';
import {
  hexToBytes,
  keccak256,
} from 'viem';

import type {
  Signature,
  ZeroXString,
} from '@/utils';

export interface SignerAdapter {
  signDigest: (digest: ZeroXString) => Promise<Signature>;
}

export interface SignedTx<TUnsigned, TRequest> {
  kind: string;
  unsigned: TUnsigned;
  signatureHash: ZeroXString;
  txHash: ZeroXString;
  signature: Signature;
  toRequest: () => TRequest;
}

export interface PreparedTx<TUnsigned, TRequest> {
  kind: string;
  unsigned: TUnsigned;
  rlpBytes: Uint8Array;
  signatureHash: ZeroXString;
  attachSignature: (
    signature: Signature
  ) => SignedTx<TUnsigned, TRequest>;
  sign: (
    signer: SignerAdapter
  ) => Promise<SignedTx<TUnsigned, TRequest>>;
}

function encodeRlpListHeader(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(
      `[1Money signing]: Invalid RLP list length: ${length}`
    );
  }

  if (length < 56) {
    return Uint8Array.from([0xc0 + length]);
  }

  const lenBytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    lenBytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Uint8Array.from([
    0xf7 + lenBytes.length,
    ...lenBytes,
  ]);
}

export function calcSignedTxHash(
  payloadRlpBytes: Uint8Array,
  signature: Signature
): ZeroXString {
  const vEncode = rlpEncode(
    typeof signature.v === 'boolean'
      ? signature.v
        ? Uint8Array.from([1])
        : new Uint8Array([])
      : BigInt(signature.v)
  );
  const rEncode = rlpEncode(hexToBytes(signature.r));
  const sEncode = rlpEncode(hexToBytes(signature.s));

  const vrsBytes = new Uint8Array(
    vEncode.length + rEncode.length + sEncode.length
  );
  vrsBytes.set(vEncode, 0);
  vrsBytes.set(rEncode, vEncode.length);
  vrsBytes.set(
    sEncode,
    vEncode.length + rEncode.length
  );

  const header = encodeRlpListHeader(
    payloadRlpBytes.length + vrsBytes.length
  );
  const encoded = new Uint8Array(
    header.length +
      payloadRlpBytes.length +
      vrsBytes.length
  );
  encoded.set(header, 0);
  encoded.set(payloadRlpBytes, header.length);
  encoded.set(
    vrsBytes,
    header.length + payloadRlpBytes.length
  );

  return keccak256(encoded) as ZeroXString;
}

export function createPreparedTx<
  TUnsigned,
  TRequest,
>(params: {
  kind: string;
  unsigned: TUnsigned;
  rlpBytes: Uint8Array;
  toRequest: (
    unsigned: TUnsigned,
    signature: Signature
  ) => TRequest;
}): PreparedTx<TUnsigned, TRequest> {
  const signatureHash = keccak256(
    params.rlpBytes
  ) as ZeroXString;

  const attachSignature = (
    signature: Signature
  ): SignedTx<TUnsigned, TRequest> => ({
    kind: params.kind,
    unsigned: params.unsigned,
    signatureHash,
    txHash: calcSignedTxHash(params.rlpBytes, signature),
    signature,
    toRequest: () =>
      params.toRequest(params.unsigned, signature),
  });

  return {
    kind: params.kind,
    unsigned: params.unsigned,
    rlpBytes: params.rlpBytes,
    signatureHash,
    attachSignature,
    sign: async signer =>
      attachSignature(
        await signer.signDigest(signatureHash)
      ),
  };
}
