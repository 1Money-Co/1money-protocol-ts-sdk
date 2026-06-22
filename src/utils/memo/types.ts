// Memo wire type and error reporting.
//
// JSON wire shape matches the Rust `Memo` DTO 1:1: each subfield is optional
// and serialized under its short name (`type`/`format`/`data`). When the
// server receives an absent or null `memo`, the request takes the legacy
// (V1) envelope path; when the field is present (even with empty subfields),
// it takes the V2 (memo-bearing) path with a disjoint tx-hash domain.
export interface Memo {
  type?: string;
  format?: string;
  data?: string;
}

export const MEMO_TYPE_MAX_BYTES = 128;
export const MEMO_FORMAT_MAX_BYTES = 64;
export const MEMO_DATA_MAX_BYTES = 256;
// Currently unreachable given the per-field caps above (128 + 64 + 256 + 16 =
// 464); retained as a future-proofing guard matching Rust.
export const MEMO_TOTAL_MAX_BYTES = 512;

// RLP overhead allowance used by the aggregate size check, matching the
// Rust `Memo::byte_size` constant so JS and Rust accept/reject the same set
// of inputs.
export const MEMO_RLP_HEADER_ALLOWANCE = 16;

export type MemoErrorCode =
  | 'MEMO_TOO_LARGE'
  | 'MEMO_TYPE_INVALID_CHARS'
  | 'MEMO_FORMAT_INVALID_CHARS'
  | 'MEMO_DATA_CONTROL_CHARS'
  | 'MEMO_TYPE_TOO_LONG'
  | 'MEMO_FORMAT_TOO_LONG'
  | 'MEMO_DATA_TOO_LONG';

export class MemoValidationError extends Error {
  constructor(
    public readonly code: MemoErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MemoValidationError';
  }
}
