import type {
  Signature,
  ZeroXString
} from '@/utils';

// The accepted authorization.type tags on the /v2 write surface.
// An unknown tag is rejected server-side with
// UNSUPPORTED_AUTHORIZATION_TYPE.
export const KNOWN_AUTHORIZATION_TYPES = [
  'single_secp256k1',
  'multisig_secp256k1'
] as const;

export interface NativeMultiSigSignatureEntry {
  signer_pubkey: ZeroXString;
  signature: { r: ZeroXString; s: ZeroXString; v: 0 | 1 };
}

export type NativeAuthorizationRequest =
  | {
      type: 'single_secp256k1';
      signature: {
        r: ZeroXString;
        s: ZeroXString;
        v: 0 | 1;
      };
    }
  | {
      type: 'multisig_secp256k1';
      account: ZeroXString;
      signatures: NativeMultiSigSignatureEntry[];
    };

// v2 requires y-parity. A legacy 27/28 means the caller signed the
// wrong digest, so it is rejected rather than converted.
export function toParityV(
  signature: Signature
): 0 | 1 {
  const v =
    typeof signature.v === 'boolean'
      ? signature.v
        ? 1
        : 0
      : signature.v;
  if (v !== 0 && v !== 1) {
    throw new Error(
      `[1Money SDK]: Invalid signature v for native v2: ${String(signature.v)} (must be 0 or 1)`
    );
  }
  return v;
}

export function singleSecp256k1(
  signature: Signature
): NativeAuthorizationRequest {
  return {
    type: 'single_secp256k1',
    signature: {
      r: signature.r,
      s: signature.s,
      v: toParityV(signature)
    }
  };
}
