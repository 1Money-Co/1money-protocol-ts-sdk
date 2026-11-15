import { hexToBytes, keccak256 } from 'viem';

import {
  encodeRlpPayload,
  rlpValue
} from '@/utils';
import { NATIVE_TX_DOMAIN_V2 } from './domain';
import { toParityV } from './authorization';

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

// payload_rlp is always WithMemo<Payload> for every registered native-v2
// operation. Empty business memo is the three-empty-string memo list.
export function encodePayloadRlp(params: {
  chainId: number;
  nonce: number;
  payloadFields: PlpPayload[];
  memo: RequiredMemo;
}): Uint8Array {
  return encodeFieldsPayloadRlp(
    [
      ...chainAndNonceHeader(params.chainId, params.nonce),
      ...params.payloadFields
    ],
    params.memo
  );
}

// The header of every operation that carries its signer's nonce.
export function chainAndNonceHeader(
  chainId: number,
  nonce: number
): PlpPayload[] {
  return [rlpValue.uint(chainId), rlpValue.uint(nonce)];
}

// The memo wrapper over a complete business field list, header
// included: the lane clawback has no signer nonce in its header.
export function encodeFieldsPayloadRlp(
  fields: PlpPayload[],
  memo: RequiredMemo
): Uint8Array {
  return encodeRlpPayload(
    rlpValue.list([
      rlpValue.list(fields),
      rlpValue.list([
        rlpValue.string(memo.type),
        rlpValue.string(memo.format),
        rlpValue.string(memo.data)
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
    rlpValue.uint(toParityV(signature))
  ]);
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

// Multisig authorization submission is out of scope for this
// release, but a caller can still call this directly and get a
// confidently-computed transactionHash for a transaction the node
// will reject -- so the ordering rule is enforced here rather than
// left to the caller. Reject, never reorder: the spec requires
// strictly-ascending order by compressed pubkey with no duplicates,
// and silently sorting would compute a hash for a different (and
// possibly unintended) signer ordering than the one passed in.
function assertAscendingPubkeys(
  entries: MultiSigProofEntry[]
): void {
  for (let i = 1; i < entries.length; i += 1) {
    const prev = hexToBytes(
      entries[i - 1].signerPubkey as `0x${string}`
    );
    const curr = hexToBytes(
      entries[i].signerPubkey as `0x${string}`
    );
    const cmp = compareBytes(curr, prev);
    if (cmp === 0) {
      throw new Error(
        `[1Money SDK]: Invalid multisig proof: duplicate signerPubkey ${entries[i].signerPubkey}`
      );
    }
    if (cmp < 0) {
      throw new Error(
        `[1Money SDK]: Invalid multisig proof: signerPubkey ${entries[i].signerPubkey} is not in strictly ascending order (must sort after ${entries[i - 1].signerPubkey})`
      );
    }
  }
}

// [[signer_pubkey, r, s, v], ...] with each pubkey an ordinary
// 33-byte string. Entries must already be in strictly ascending
// order by compressed pubkey with no duplicates -- enforced above,
// not reordered.
export function multisigProof(
  entries: MultiSigProofEntry[]
): PlpPayload {
  assertAscendingPubkeys(entries);
  return rlpValue.list(
    entries.map(entry =>
      rlpValue.list([
        // The pubkey IS an ordinary 33-byte string here, unlike
        // CreateMultiSigPayload.signers[].public_key.
        rlpValue.hex(entry.signerPubkey),
        rlpValue.uint(BigInt(entry.signature.r)),
        rlpValue.uint(BigInt(entry.signature.s)),
        rlpValue.uint(toParityV(entry.signature))
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
