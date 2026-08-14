import { expect } from 'chai';

import {
  getIntegrationContext,
  resetIntegrationContext
} from '../context';
import { resetTestAccounts } from '../setup';

describe('integration context', function () {
  const original = { ...process.env };

  afterEach(function () {
    process.env = { ...original };
    resetIntegrationContext();
    resetTestAccounts();
  });

  it('derives the operator address from its private key', function () {
    process.env.INTEGRATION_TEST_NETWORK =
      'local';
    process.env.INTEGRATION_TEST_OPERATOR_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    resetIntegrationContext();
    resetTestAccounts();

    expect(
      getIntegrationContext().accounts.operator
        .address
    ).to.equal(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    );
  });

  it('returns one context for one configured network', function () {
    process.env.INTEGRATION_TEST_NETWORK =
      'local';
    resetIntegrationContext();

    const first = getIntegrationContext();
    const second = getIntegrationContext();

    expect(second).to.equal(first);
    expect(second.client).to.equal(first.client);
  });

  it('rejects enabled state-changing tests on mainnet', function () {
    process.env.RUN_INTEGRATION_TESTS = 'true';
    process.env.INTEGRATION_TEST_NETWORK =
      'mainnet';
    resetIntegrationContext();

    expect(() => getIntegrationContext()).to.throw(
      'refuses to run state-changing integration tests on mainnet'
    );
  });

  it('rejects an unknown network instead of casting it', function () {
    process.env.INTEGRATION_TEST_NETWORK =
      'staging';
    resetIntegrationContext();

    expect(() => getIntegrationContext()).to.throw(
      'Invalid INTEGRATION_TEST_NETWORK'
    );
  });
});
