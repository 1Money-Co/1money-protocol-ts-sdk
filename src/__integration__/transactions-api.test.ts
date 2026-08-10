import { expect } from 'chai';
import 'mocha';

import { getIntegrationContext } from './context';

type Context = ReturnType<
  typeof getIntegrationContext
>;

describe('transactions API integration', function () {
  let context: Context;

  before(function () {
    context = getIntegrationContext();
    if (!context.config.enabled) {
      this.skip();
    }
  });

  it('exposes transaction reads', function () {
    const { transactions } = context.client;

    expect(transactions.getByHash).to.be.a(
      'function'
    );
    expect(transactions.getReceiptByHash).to.be.a(
      'function'
    );
    expect(transactions.getFinalizedByHash).to.be.a(
      'function'
    );
    expect(transactions.estimateFee).to.be.a(
      'function'
    );
    expect(
      transactions.estimateBatchPaymentFee
    ).to.be.a('function');
  });

  it('exposes v2 payment methods', function () {
    expect(
      context.client.transactions.payment
    ).to.be.a('function');
    expect(
      context.client.transactions.batchPayment
    ).to.be.a('function');
  });
});
