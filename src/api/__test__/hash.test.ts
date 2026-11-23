import { expect } from 'chai';
import 'mocha';

import { sameHash } from '../hash';

// The pinned Rust build (B256::from_str through const-hex 1.18.1 at
// l1client dc5cffa0b) accepts a lowercase "0x" prefix or none, and
// hex digits in any case.
describe('sameHash', function () {
  const DIGITS = 'ab'.repeat(32);
  const HASH = `0x${DIGITS}`;

  it('matches "0x" and bare hex', function () {
    expect(sameHash(HASH, DIGITS)).to.equal(true);
    expect(sameHash(DIGITS, HASH)).to.equal(true);
    expect(sameHash(HASH, HASH)).to.equal(true);
  });

  it('matches hex digits in any case', function () {
    expect(sameHash(HASH, `0x${DIGITS.toUpperCase()}`)).to.equal(true);
    expect(sameHash(HASH, `0xaB${DIGITS.slice(2)}`)).to.equal(true);
  });

  it('does not match an upper-case "0X" prefix', function () {
    expect(sameHash(HASH, `0X${DIGITS}`)).to.equal(false);
    expect(sameHash(`0X${DIGITS}`, `0X${DIGITS}`)).to.equal(false);
  });

  it('does not match a wrong length, non-hex digits or a non-string', function () {
    expect(sameHash(HASH, `${HASH}ab`)).to.equal(false);
    expect(sameHash(HASH, HASH.slice(0, -2))).to.equal(false);
    expect(sameHash(HASH, `0x${'zz'.repeat(32)}`)).to.equal(false);
    expect(sameHash(HASH, `0x0x${DIGITS}`)).to.equal(false);
    expect(sameHash(HASH, '')).to.equal(false);
    expect(sameHash(HASH, undefined)).to.equal(false);
    expect(sameHash(HASH, 42)).to.equal(false);
  });

  it('does not match two different hashes', function () {
    expect(sameHash(HASH, `0x${'cd'.repeat(32)}`)).to.equal(false);
  });
});

// The Rust oracle: B256::from_str and the JSON decoder of the pinned
// build (alloy-primitives 1.5.7, const-hex 1.18.1, l1client dc5cffa0b
// Cargo.lock) on 17 inputs; both agree on every row. Copied from
// 1Money-Co/1money-protocol-go-sdk testdata/b256-oracle/b256_oracle.tsv
// at 58f2253aa8d8aa17176a2883718ceecf94fc16c6. Each row: name, input,
// and the 64 lowercase digits it decodes to, or null when refused.
const B256_ORACLE: readonly [string, string, string | null][] = [
  ["lowercase 0x", "0x1111111111111111111111111111111111111111111111111111111111111111", "1111111111111111111111111111111111111111111111111111111111111111"],
  ["bare", "1111111111111111111111111111111111111111111111111111111111111111", "1111111111111111111111111111111111111111111111111111111111111111"],
  ["uppercase 0X", "0X1111111111111111111111111111111111111111111111111111111111111111", null],
  ["0x, upper digits", "0xABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB", "abababababababababababababababababababababababababababababababab"],
  ["bare, upper digits", "ABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB", "abababababababababababababababababababababababababababababababab"],
  ["0x, mixed digits", "0xAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaB", "abababababababababababababababababababababababababababababababab"],
  ["bare, mixed digits", "AbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaBabAbaB", "abababababababababababababababababababababababababababababababab"],
  ["0X, upper digits", "0X1111111111111111111111111111111111111111111111111111111111111111", null],
  ["0x, 63 digits", "0x111111111111111111111111111111111111111111111111111111111111111", null],
  ["0x, 65 digits", "0x11111111111111111111111111111111111111111111111111111111111111111", null],
  ["0x, 66 digits", "0x111111111111111111111111111111111111111111111111111111111111111111", null],
  ["0x, non-hex", "0x111111111111111111111111111111111111111111111111111111111111111g", null],
  ["double 0x", "0x0x111111111111111111111111111111111111111111111111111111111111", null],
  ["empty", "", null],
  ["0x only", "0x", null],
  ["leading space", " 0x1111111111111111111111111111111111111111111111111111111111111111", null],
  ["x only prefix", "x1111111111111111111111111111111111111111111111111111111111111111", null],
];

describe('sameHash against the Rust B256 oracle', function () {
  for (const [name, input, digits] of B256_ORACLE) {
    it(`${digits === null ? 'refuses' : 'accepts'} ${name}`, function () {
      const valid = `0x${digits ?? '11'.repeat(32)}`;
      expect(sameHash(input, valid)).to.equal(digits !== null);
      expect(sameHash(valid, input)).to.equal(digits !== null);
      expect(sameHash(input, input)).to.equal(digits !== null);
    });
  }
});
