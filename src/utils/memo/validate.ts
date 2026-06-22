import {
  MEMO_DATA_MAX_BYTES,
  MEMO_FORMAT_MAX_BYTES,
  MEMO_RLP_HEADER_ALLOWANCE,
  MEMO_TOTAL_MAX_BYTES,
  MEMO_TYPE_MAX_BYTES,
  Memo,
  MemoValidationError,
} from './types';

const enc = new TextEncoder();

// RFC 3986 unreserved + gen-delims + sub-delims + percent. Matches
// `is_url_safe` in `om-primitives-types/.../memo.rs`.
const URL_SAFE_RE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;

function utf8Len(s: string): number {
  return enc.encode(s).length;
}

// Mirrors Rust `Memo::byte_size`: sum of subfield UTF-8 byte lengths plus a
// fixed 16-byte allowance for RLP framing. Used only by the aggregate cap.
function byteSize(memo: Memo): number {
  return (
    utf8Len(memo.type ?? '') +
    utf8Len(memo.format ?? '') +
    utf8Len(memo.data ?? '') +
    MEMO_RLP_HEADER_ALLOWANCE
  );
}

// Validate per the same rules as Rust `Memo::validate()`.
//
// Per-field checks fire before the aggregate check, matching Rust ordering
// — clients should expect the same error code the server would return.
export function validateMemo(memo: Memo): void {
  const t = memo.type ?? '';
  if (t.length > 0) {
    const len = utf8Len(t);
    if (len > MEMO_TYPE_MAX_BYTES) {
      throw new MemoValidationError(
        'MEMO_TYPE_TOO_LONG',
        `memo.type exceeds ${MEMO_TYPE_MAX_BYTES} bytes (got ${len})`
      );
    }
    if (!URL_SAFE_RE.test(t)) {
      throw new MemoValidationError(
        'MEMO_TYPE_INVALID_CHARS',
        'memo.type contains non-URL-safe characters'
      );
    }
  }

  const f = memo.format ?? '';
  if (f.length > 0) {
    const len = utf8Len(f);
    if (len > MEMO_FORMAT_MAX_BYTES) {
      throw new MemoValidationError(
        'MEMO_FORMAT_TOO_LONG',
        `memo.format exceeds ${MEMO_FORMAT_MAX_BYTES} bytes (got ${len})`
      );
    }
    if (!URL_SAFE_RE.test(f)) {
      throw new MemoValidationError(
        'MEMO_FORMAT_INVALID_CHARS',
        'memo.format contains non-URL-safe characters'
      );
    }
  }

  const d = memo.data ?? '';
  if (d.length > 0) {
    const len = utf8Len(d);
    if (len > MEMO_DATA_MAX_BYTES) {
      throw new MemoValidationError(
        'MEMO_DATA_TOO_LONG',
        `memo.data exceeds ${MEMO_DATA_MAX_BYTES} bytes (got ${len})`
      );
    }
    // Reject NUL and any C0/C1 control codepoint (Unicode general category
    // Cc). Rust's check is `c == '\0' || c.is_control()`.
    for (const ch of d) {
      const cp = ch.codePointAt(0)!;
      if (
        cp === 0 ||
        cp <= 0x1f ||
        (cp >= 0x7f && cp <= 0x9f) ||
        (cp >= 0xd800 && cp <= 0xdfff)
      ) {
        throw new MemoValidationError(
          'MEMO_DATA_CONTROL_CHARS',
          'memo.data contains null bytes or Unicode control/surrogate codepoints'
        );
      }
    }
  }

  const total = byteSize(memo);
  if (total > MEMO_TOTAL_MAX_BYTES) {
    throw new MemoValidationError(
      'MEMO_TOO_LARGE',
      `memo object exceeds ${MEMO_TOTAL_MAX_BYTES} bytes (got ${total})`
    );
  }
}
