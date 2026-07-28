import { expect } from 'chai';
import 'mocha';

import api from '../';

describe('v2 write surface', function () {
  const client = api({
    network: 'testnet',
    timeout: 3000
  });

  it('exposes v2 transaction writes', function () {
    expect(
      client.transactions.payment
    ).to.be.a('function');
    expect(
      client.transactions.batchPayment
    ).to.be.a('function');
  });

  it('exposes all eleven v2 token writes', function () {
    [
      'issueToken',
      'mintToken',
      'burnToken',
      'clawbackToken',
      'grantAuthority',
      'manageBlacklist',
      'manageWhitelist',
      'pauseToken',
      'updateMetadata',
      'bridgeAndMint',
      'burnAndBridge'
    ].forEach(name => {
      expect(
        (client.tokens as Record<string, unknown>)[
          name
        ]
      ).to.be.a('function');
    });
  });

  it('exposes the v2-only multisig creation route', function () {
    expect(
      client.accounts.createMultisig
    ).to.be.a('function');
  });

  it('keeps the legacy writes under legacyV1', function () {
    expect(
      client.transactions.legacyV1.payment
    ).to.be.a('function');
    expect(
      client.tokens.legacyV1.mintToken
    ).to.be.a('function');
  });

  it('does not expose a legacy multisig route', function () {
    expect(
      (
        client.accounts as Record<string, unknown>
      ).legacyV1
    ).to.equal(undefined);
  });

  it('keeps read methods on their v1 paths', function () {
    expect(client.accounts.getNonce).to.be.a(
      'function'
    );
    expect(
      client.transactions.getByHash
    ).to.be.a('function');
    expect(
      client.tokens.getTokenMetadata
    ).to.be.a('function');
  });
});
