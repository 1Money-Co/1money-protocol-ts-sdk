import type { Memo } from '@/utils';
import type { TokenAuthorityUnsigned } from '../builders/tokenAuthority';
import type { TokenMetadataUnsigned } from '../builders/tokenMetadata';
import type { RequiredMemo } from './encoding';

// On the /v2 surface the memo object and all three of its fields
// are required. Empty strings mean "no business memo" and still
// produce the canonical three-empty-string RLP list, which is a
// different value from an empty list or an omitted field.
export type { RequiredMemo };

export function toRequiredMemo(
  memo?: Memo
): RequiredMemo {
  return {
    type: memo?.type ?? '',
    format: memo?.format ?? '',
    data: memo?.data ?? ''
  };
}

// TokenAuthorityPayload.value is a non-optional U256 on the node,
// defaulting to 0. The SDK type keeps it optional for callers, so the
// wire layer fills it in.
export function tokenAuthorityWireFields(
  unsigned: TokenAuthorityUnsigned
): Record<string, unknown> {
  return {
    ...unsigned,
    value: unsigned.value ?? '0'
  };
}

// The default body spread is shallow, so an operation carrying a
// nested array would leave the request aliasing the caller's
// objects. A caller mutating that array after authorize() would
// change the body being POSTed while transactionHash stays fixed
// -- the signed bytes and the sent bytes silently diverge. Copy
// the nested structures for every operation that has one.
export function tokenMetadataWireFields(
  unsigned: TokenMetadataUnsigned
): Record<string, unknown> {
  return {
    ...unsigned,
    additional_metadata:
      unsigned.additional_metadata.map(pair => ({
        ...pair
      }))
  };
}
