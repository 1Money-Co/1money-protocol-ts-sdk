import { expect } from 'chai';

import {
  createPrivateKeySigner,
  TransactionBuilder
} from '@/signing';

import { authorizeAndSubmitV2 } from '../v2';

const signer = createPrivateKeySigner(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
);

function payment() {
  return TransactionBuilder.payment({
    chain_id: 1212101,
    nonce: 0,
    recipient:
      '0x0000000000000000000000000000000000000001',
    value: '1',
    token:
      '0x0000000000000000000000000000000000000002'
  });
}

describe('integration v2 submission helper', function () {
  it('authorizes the signing hash and returns matching hashes', async function () {
    const result = await authorizeAndSubmitV2(
      payment(),
      signer,
      async authorized => ({
        hash: authorized.transactionHash
      })
    );

    expect(result.authorized.path).to.equal(
      '/v2/transactions/payment'
    );
    expect(result.response.hash).to.equal(
      result.authorized.transactionHash
    );
  });

  it('rejects a response hash that differs from the local hash', async function () {
    let error: unknown;
    try {
      await authorizeAndSubmitV2(
        payment(),
        signer,
        async () => ({
          hash:
            '0x0000000000000000000000000000000000000000000000000000000000000000'
        })
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).to.contain(
      'returned a different transaction hash'
    );
  });
});
