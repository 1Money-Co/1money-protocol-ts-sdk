import { expect } from 'chai';
import 'mocha';

import { batchPaymentReadFixture } from '../batchPaymentData.fixture';

describe('Batch Payment read type fixture', function () {
  it('does not model max_fee on Batch Payment receipt data', function () {
    expect(batchPaymentReadFixture).to.not.have.property(
      'max_fee'
    );
  });
});
