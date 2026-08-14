import { expect } from 'chai';
import 'mocha';

import api from '../';
import statusApi from '../status';

describe('status api', function () {
  it('is registered on the client', function () {
    const client = api({
      network: 'testnet',
      timeout: 3000
    });
    expect(client.status).to.be.an('object');
    expect(
      client.status.getNativeWriteStatus
    ).to.be.a('function');
    expect(client.status.getHealth).to.be.a(
      'function'
    );
  });

  it('exposes the same module as the default export', function () {
    expect(
      statusApi.getNativeWriteStatus
    ).to.be.a('function');
  });
});
