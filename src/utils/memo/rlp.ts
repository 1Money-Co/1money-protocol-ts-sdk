import { rlpValue, type PlpPayload } from '@/utils';
import type { Memo } from './types';

// RLP encoding of `Memo` matches the Rust `RlpEncodable` derive: a list of
// three byte strings in field order [type, format, data]. Empty subfields
// encode as empty byte strings (RLP `0x80`).
export function memoRlpList(memo: Memo): PlpPayload {
  return rlpValue.list([
    rlpValue.string(memo.type ?? ''),
    rlpValue.string(memo.format ?? ''),
    rlpValue.string(memo.data ?? ''),
  ]);
}
