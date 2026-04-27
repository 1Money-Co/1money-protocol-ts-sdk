import {
  encodeRlpPayload,
  memoRlpList,
  rlpValue,
  validateMemo,
  type Memo,
  type PlpPayload,
  type Signature,
} from '@/utils';
import { createPreparedTx } from '../core';

// All unsigned payload types share these required fields. `chain_id` and
// `nonce` are the first two RLP elements of every transaction; the helper
// encodes them automatically so each builder only declares the fields that
// follow.
type UnsignedBase = { chain_id: number; nonce: number; memo?: Memo };

// Build a `PreparedTx` for any transaction shape:
// 1. Prepend `[chain_id, nonce]` and the caller's `payloadFields` into one
//    RLP inner list.
// 2. Branch on `unsigned.memo`:
//    - V1 (memo absent): RLP-encode `innerList` directly. Bytes are byte-
//      identical to the pre-memo SDK. `kind` is `<kindV1>`.
//    - V2 (memo present): validate the memo, then RLP-encode
//      `[innerList, memoRlpList(memo)]` — the `WithMemo<T>` envelope shape.
//      `kind` is `<kindV1>_v2`.
// 3. Wire the result into `createPreparedTx`.
//
// `memo == null` deliberately catches both `null` and `undefined` so untyped
// JS callers behave the same as strict TypeScript callers (whose declared
// `Memo | undefined` would only ever produce `undefined`).
//
// Builders only need to call validators, construct `payloadFields`, and pass
// `toRequest`.
export function buildTx<T extends UnsignedBase, R>(opts: {
  kind: string;
  unsigned: T;
  payloadFields: PlpPayload[];
  toRequest: (payload: T, signature: Signature) => R;
}) {
  const innerList = rlpValue.list([
    rlpValue.uint(opts.unsigned.chain_id),
    rlpValue.uint(opts.unsigned.nonce),
    ...opts.payloadFields,
  ]);

  const memo = opts.unsigned.memo;
  let rlpBytes: Uint8Array;
  let kind: string;
  if (memo == null) {
    rlpBytes = encodeRlpPayload(innerList);
    kind = opts.kind;
  } else {
    validateMemo(memo);
    rlpBytes = encodeRlpPayload(
      rlpValue.list([innerList, memoRlpList(memo)])
    );
    kind = `${opts.kind}_v2`;
  }

  return createPreparedTx<T, R>({
    kind,
    unsigned: opts.unsigned,
    rlpBytes,
    toRequest: opts.toRequest,
  });
}
