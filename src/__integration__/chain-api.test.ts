import { expect } from 'chai';
import 'mocha';

import { getIntegrationContext } from './context';

type Context = ReturnType<
  typeof getIntegrationContext
>;

describe('chain API integration', function () {
  let context: Context;

  before(function () {
    context = getIntegrationContext();
    if (!context.config.enabled) {
      this.skip();
    }
  });

  it('exposes the chain id method', function () {
    expect(context.client.chain.getChainId).to.be
      .a('function');
  });

  it('fetches the configured chain id', async function () {
    const response =
      await context.client.chain.getChainId();

    expect(response.chain_id).to.be.a('number');
    expect(response.chain_id).to.be.greaterThan(0);
  });
});
