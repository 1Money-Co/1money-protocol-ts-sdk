import { expect } from 'chai';
import 'mocha';
import { bytesToHex } from 'viem';

import {
  NATIVE_TX_DOMAIN_V2,
  NativeOperationType
} from '../domain';

describe('native v2 domain constants', function () {
  it('matches the frozen domain tag bytes', function () {
    expect(NATIVE_TX_DOMAIN_V2).to.have.length(28);
    expect(bytesToHex(NATIVE_TX_DOMAIN_V2)).to.equal(
      '0x316d6f6e65792e6e61746976652e7472616e73616374696f6e2e7632'
    );
  });

  it('has all fourteen frozen operation ids', function () {
    expect(
      Object.values(NativeOperationType)
    ).to.deep.equal([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
    ]);
    expect(NativeOperationType.Payment).to.equal(1);
    expect(
      NativeOperationType.BatchPayment
    ).to.equal(14);
  });
});
