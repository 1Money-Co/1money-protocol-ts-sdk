import { expect } from 'chai';
import 'mocha';

import {
  singleSecp256k1,
  toParityV
} from '../authorization';

const R = `0x${'11'.repeat(32)}` as `0x${string}`;
const S = `0x${'22'.repeat(32)}` as `0x${string}`;

describe('native v2 authorization', function () {
  it('emits an explicitly tagged single authorization', function () {
    const auth = singleSecp256k1({
      r: R,
      s: S,
      v: 1
    });
    expect(auth).to.deep.equal({
      type: 'single_secp256k1',
      signature: { r: R, s: S, v: 1 }
    });
  });

  it('normalizes a boolean v to 0 or 1', function () {
    expect(
      toParityV({ r: R, s: S, v: true })
    ).to.equal(1);
    expect(
      toParityV({ r: R, s: S, v: false })
    ).to.equal(0);
  });

  it('rejects every non-parity v', function () {
    [2, 27, 28, 35, 36, 37, 38].forEach(v => {
      expect(() =>
        toParityV({ r: R, s: S, v })
      ).to.throw(/must be 0 or 1/);
    });
  });

  it('never emits a legacy top-level signature field', function () {
    const auth = singleSecp256k1({
      r: R,
      s: S,
      v: 0
    });
    expect(
      Object.keys(auth).sort()
    ).to.deep.equal(['signature', 'type']);
  });
});
