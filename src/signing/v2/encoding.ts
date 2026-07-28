import { keccak256 } from 'viem';

import {
  encodeRlpPayload,
  rlpValue
} from '@/utils';
import { NATIVE_TX_DOMAIN_V2 } from './domain';

import type {
  PlpPayload,
  Signature,
  ZeroXString
} from '@/utils';

// The always-present three-field memo. Every subfield is a
// string; empty strings mean "no business memo".
export interface RequiredMemo {
  type: string;
  format: string;
  data: string;
}

export interface MultiSigProofEntry {
  signerPubkey: ZeroXString;
  signature: Signature;
}

// v must be y-parity on the v2 surface. A legacy 27/28 is evidence
// the caller signed the wrong digest, so it is rejected rather than
// normalized. See native-v2-signing-spec section 3.
function parityV(signature: Signature): 0 | 1 {
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

// payload_rlp — the canonical payload's own complete RLP encoding.
// Memo-capable operations wrap the payload in WithMemo<T>;
// BatchPayment passes memo: null and encodes the bare list.
export function encodePayloadRlp(params: {
  chainId: number;
  nonce: number;
  payloadFields: PlpPayload[];
  memo: RequiredMemo | null;
}): Uint8Array {
  const innerList = rlpValue.list([
    rlpValue.uint(params.chainId),
    rlpValue.uint(params.nonce),
    ...params.payloadFields
  ]);

  if (params.memo === null) {
    return encodeRlpPayload(innerList);
  }

  return encodeRlpPayload(
    rlpValue.list([
      innerList,
      rlpValue.list([
        rlpValue.string(params.memo.type),
        rlpValue.string(params.memo.format),
        rlpValue.string(params.memo.data)
      ])
    ])
  );
}

export function singleDescriptor(): PlpPayload {
  return rlpValue.list([rlpValue.uint(0)]);
}

export function multisigDescriptor(
  account: ZeroXString
): PlpPayload {
  return rlpValue.list([
    rlpValue.uint(1),
    rlpValue.address(account)
  ]);
}

// [r, s, v] — note the order differs from the legacy [v, r, s].
// r and s are canonical minimal-length unsigned integers, not
// fixed 32-byte strings, so they go through `uint`, never `hex`.
export function singleProof(
  signature: Signature
): PlpPayload {
  return rlpValue.list([
    rlpValue.uint(BigInt(signature.r)),
    rlpValue.uint(BigInt(signature.s)),
    rlpValue.uint(parityV(signature))
  ]);
}

// [[signer_pubkey, r, s, v], ...] with each pubkey an ordinary
// 33-byte string. Entries are encoded in the order supplied; the
// canonical ascending order is enforced where the list is built.
export function multisigProof(
  entries: MultiSigProofEntry[]
): PlpPayload {
  return rlpValue.list(
    entries.map(entry =>
      rlpValue.list([
        // The pubkey IS an ordinary 33-byte string here, unlike
        // CreateMultiSigPayload.signers[].public_key.
        rlpValue.hex(entry.signerPubkey),
        rlpValue.uint(BigInt(entry.signature.r)),
        rlpValue.uint(BigInt(entry.signature.s)),
        rlpValue.uint(parityV(entry.signature))
      ])
    )
  );
}

export function unsignedTransactionRlp(
  operationType: number,
  descriptor: PlpPayload,
  payloadRlp: Uint8Array
): Uint8Array {
  return encodeRlpPayload(
    rlpValue.list([
      rlpValue.bytes(NATIVE_TX_DOMAIN_V2),
      rlpValue.uint(operationType),
      descriptor,
      rlpValue.bytes(payloadRlp)
    ])
  );
}

export function signingHashV2(
  operationType: number,
  descriptor: PlpPayload,
  payloadRlp: Uint8Array
): ZeroXString {
  return keccak256(
    unsignedTransactionRlp(
      operationType,
      descriptor,
      payloadRlp
    )
  ) as ZeroXString;
}

// The proof is appended as a fifth element and the WHOLE list is
// re-encoded. This is not the unsigned bytes concatenated with the
// proof bytes: the outer list-length header differs.
export function signedTransactionRlp(
  operationType: number,
  descriptor: PlpPayload,
  payloadRlp: Uint8Array,
  proof: PlpPayload
): Uint8Array {
  return encodeRlpPayload(
    rlpValue.list([
      rlpValue.bytes(NATIVE_TX_DOMAIN_V2),
      rlpValue.uint(operationType),
      descriptor,
      rlpValue.bytes(payloadRlp),
      proof
    ])
  );
}

export function transactionHashV2(
  operationType: number,
  descriptor: PlpPayload,
  payloadRlp: Uint8Array,
  proof: PlpPayload
): ZeroXString {
  return keccak256(
    signedTransactionRlp(
      operationType,
      descriptor,
      payloadRlp,
      proof
    )
  ) as ZeroXString;
}
