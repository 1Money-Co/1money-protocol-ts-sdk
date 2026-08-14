import { expect } from 'chai';
import 'mocha';

import { getIntegrationContext } from './context';

type Context = ReturnType<
  typeof getIntegrationContext
>;

describe('accounts API integration', function () {
  let context: Context;

  before(function () {
    context = getIntegrationContext();
    if (!context.config.enabled) {
      this.skip();
    }
  });

  it('exposes account read and v2 write methods', function () {
    expect(context.client.accounts.getNonce).to.be
      .a('function');
    expect(
      context.client.accounts.getTokenAccount
    ).to.be.a('function');
    expect(
      context.client.accounts.createMultisig
    ).to.be.a('function');
  });

  it('fetches the derived operator nonce', async function () {
    const response =
      await context.client.accounts.getNonce(
        context.accounts.operator.address
      );

    expect(response.nonce).to.be.a('number');
    expect(response.nonce).to.be.at.least(0);
  });
});
