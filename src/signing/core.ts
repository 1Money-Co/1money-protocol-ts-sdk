import { keccak256 } from 'viem';

import type { Signature } from '@/utils';

export type Hex = `0x${string}`;

export interface SignerAdapter {
  signDigest: (digest: Hex) => Promise<Signature>;
}

export interface SignedTx<TUnsigned, TRequest> {
  kind: string;
  unsigned: TUnsigned;
  signatureHash: Hex;
  signature: Signature;
  toRequest: () => TRequest;
}

export interface PreparedTx<TUnsigned, TRequest> {
  kind: string;
  unsigned: TUnsigned;
  rlpBytes: Uint8Array;
  signatureHash: Hex;
  attachSignature: (
    signature: Signature
  ) => SignedTx<TUnsigned, TRequest>;
  sign: (
    signer: SignerAdapter
  ) => Promise<SignedTx<TUnsigned, TRequest>>;
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
  ) as Hex;

  const attachSignature = (
    signature: Signature
  ): SignedTx<TUnsigned, TRequest> => ({
    kind: params.kind,
    unsigned: params.unsigned,
    signatureHash,
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
