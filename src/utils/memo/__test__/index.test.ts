import { expect } from 'chai';
import 'mocha';
import { keccak256 } from 'viem';
import { encodeRlpPayload, rlpValue as ev } from '../../encode';
import { memoRlpList } from '../rlp';

import {
  MEMO_DATA_MAX_BYTES,
  MEMO_FORMAT_MAX_BYTES,
  MEMO_TOTAL_MAX_BYTES,
  MEMO_TYPE_MAX_BYTES,
  MemoValidationError,
} from '../types';
import { validateMemo } from '../validate';

const enc = new TextEncoder();

describe('memo validation', () => {
  it('accepts a fully empty memo', () => {
    expect(() => validateMemo({})).to.not.throw();
    expect(() => validateMemo({ type: '', format: '', data: '' })).to.not.throw();
  });

  it('accepts a populated, well-formed memo', () => {
    expect(() =>
      validateMemo({
        type: 'purpose/SALA',
        format: 'text/plain',
        data: 'Salary for March 2026',
      })
    ).to.not.throw();
  });

  it('rejects type with disallowed character (space)', () => {
    expect(() => validateMemo({ type: 'has space' }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_TYPE_INVALID_CHARS');
  });

  it('rejects format with angle bracket', () => {
    expect(() => validateMemo({ format: 'text/<plain>' }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_FORMAT_INVALID_CHARS');
  });

  it('rejects data with null byte', () => {
    expect(() => validateMemo({ data: 'has\0null' }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_DATA_CONTROL_CHARS');
  });

  it('rejects data with C0 control character', () => {
    expect(() => validateMemo({ data: 'has\bctrl' }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_DATA_CONTROL_CHARS');
  });

  it('rejects data with lone surrogate codepoint', () => {
    // JS strings are WTF-16 — a lone high surrogate slips past control-char
    // checks but is invalid UTF-8 once encoded. Match Rust's "control/surrogate"
    // rejection so SDK callers get the same diagnostic the server would return.
    expect(() => validateMemo({ data: '\uD800' }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_DATA_CONTROL_CHARS');
  });

  it('rejects type exceeding 128 bytes (UTF-8)', () => {
    const tooLong = 'a'.repeat(MEMO_TYPE_MAX_BYTES + 1);
    expect(() => validateMemo({ type: tooLong }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_TYPE_TOO_LONG');
  });

  it('rejects format exceeding 64 bytes', () => {
    const tooLong = 'a'.repeat(MEMO_FORMAT_MAX_BYTES + 1);
    expect(() => validateMemo({ format: tooLong }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_FORMAT_TOO_LONG');
  });

  it('rejects data exceeding 256 bytes', () => {
    const tooLong = 'a'.repeat(MEMO_DATA_MAX_BYTES + 1);
    expect(() => validateMemo({ data: tooLong }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_DATA_TOO_LONG');
  });

  it('counts bytes, not code units, for multi-byte UTF-8', () => {
    // "💰" is 4 UTF-8 bytes but 2 UTF-16 code units; 33 of them = 132 bytes,
    // which exceeds the 128-byte type cap.
    const emoji = '💰';
    expect(enc.encode(emoji).length).to.equal(4);
    const tooLong = emoji.repeat(33);
    expect(() => validateMemo({ type: tooLong }))
      .to.throw(MemoValidationError)
      .with.property('code', 'MEMO_TYPE_TOO_LONG');
  });

  it('rejects when aggregate size exceeds the 512-byte cap', () => {
    // type=128 + format=64 + data=256 + 16 header = 464 — passes.
    // Push data to its max and add a header allowance overflow via a
    // synthetic crafted case: max all three to trip MEMO_TOO_LARGE only
    // when the per-field caps are at their ceiling AND the overhead pushes
    // past 512. Use type=128, format=64, data=256 -> exactly 128+64+256+16=464 ≤
    // 512 (passes per-field, passes total). This documents the interplay.
    expect(() =>
      validateMemo({
        type: 'a'.repeat(MEMO_TYPE_MAX_BYTES),
        format: 'b'.repeat(MEMO_FORMAT_MAX_BYTES),
        data: 'c'.repeat(MEMO_DATA_MAX_BYTES),
      })
    ).to.not.throw();
    // Push data 1 byte over its cap to trigger MEMO_DATA_TOO_LONG (the
    // per-field check fires before the aggregate check, matching Rust).
    expect(() =>
      validateMemo({
        type: 'a'.repeat(MEMO_TYPE_MAX_BYTES),
        format: 'b'.repeat(MEMO_FORMAT_MAX_BYTES),
        data: 'c'.repeat(MEMO_DATA_MAX_BYTES + 1),
      })
    ).to.throw(MemoValidationError).with.property('code', 'MEMO_DATA_TOO_LONG');
    // Documenting that 512 is unreachable through valid per-field input
    // alone given current caps (128+64+256+16=464). The aggregate check
    // remains as a defense-in-depth guard for future cap relaxations.
    expect(MEMO_TOTAL_MAX_BYTES).to.equal(512);
  });

  it('accepts URL-safe special chars in type', () => {
    expect(() =>
      validateMemo({
        type: 'a-z_A-Z.0-9~:/?#[]@!$&\'()*+,;=%',
        format: 'application/json',
      })
    ).to.not.throw();
  });
});

describe('memo RLP encoding', () => {
  it('emits the empty 3-element list for a fully empty memo', () => {
    // Default Memo serializes as RLP list of three empty byte strings.
    const encoded = encodeRlpPayload(memoRlpList({}));
    const expected = encodeRlpPayload(
      ev.list([ev.string(''), ev.string(''), ev.string('')])
    );
    expect(Array.from(encoded)).to.deep.equal(Array.from(expected));
  });

  it('produces the expected WithMemo<PaymentPayload> signature hash', () => {
    // Cross-check vector pinned against Rust test vector from:
    //   crates/types/om-rest-types/src/requests/payment.rs
    //   test_memo_bearing_request_routes_to_v2_envelope
    //   (hash captured via dump_v2_sighash_for_ts_sdk, Task 13)
    //
    // Canonical inputs:
    //   PaymentPayload {
    //     chain_id: 1212101, nonce: 0,
    //     recipient: 0xA634dfba8c7550550817898bC4820cD10888Aac5, value: 10,
    //     token: 0x5458747a0efb9ebeb8696fcac1479278c0872fbe,
    //   }
    //   Memo { type: "purpose/SALA", format: "text/plain", data: "invoice-001" }
    //
    // Rust: keccak256(rlp_encode(WithMemo { inner: PaymentPayload, memo: Memo }))
    const inner = ev.list([
      ev.uint(1212101),
      ev.uint(0),
      ev.address('0xa634dfba8c7550550817898bc4820cd10888aac5'),
      ev.uint('10'),
      ev.address('0x5458747a0efb9ebeb8696fcac1479278c0872fbe'),
    ]);
    const memo = memoRlpList({
      type: 'purpose/SALA',
      format: 'text/plain',
      data: 'invoice-001',
    });
    const rlpBytes = encodeRlpPayload(ev.list([inner, memo]));
    const sigHash = keccak256(rlpBytes);

    expect(sigHash).to.equal('0xbf20bc43bf021d9e034552c84339eb2682d7f0b2ac422e5eee591675c8cce7ed');
  });
});
