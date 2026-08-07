import { expect } from 'chai';
import 'mocha';

import { getIntegrationContext } from './context';

type Context = ReturnType<
  typeof getIntegrationContext
>;

describe('checkpoints API integration', function () {
  let context: Context;

  before(function () {
    context = getIntegrationContext();
    if (!context.config.enabled) {
      this.skip();
    }
  });

  it('exposes checkpoint read methods', function () {
    expect(context.client.checkpoints.getNumber).to
      .be.a('function');
    expect(context.client.checkpoints.getByHash).to.be
      .a('function');
    expect(context.client.checkpoints.getByNumber).to
      .be.a('function');
  });

  it('fetches the current checkpoint number', async function () {
    const response =
      await context.client.checkpoints.getNumber();

    expect(response.number).to.be.a('number');
    expect(response.number).to.be.at.least(0);
  });
});
