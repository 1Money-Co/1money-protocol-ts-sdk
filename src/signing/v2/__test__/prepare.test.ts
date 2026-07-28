import { expect } from 'chai';
import 'mocha';

import {
  prepareTransactionV2,
  TransactionBuilderV2
} from '../prepare';
import { OPERATION_REGISTRY } from '../registry';

const RECIPIENT =
  '0x0202020202020202020202020202020202020202';
const TOKEN =
  '0x0101010101010101010101010101010101010101';

const PAYMENT = {
  chain_id: 1212101,
  nonce: 1,
  recipient: RECIPIENT,
  value: '1000000000000000000',
  token: TOKEN
};

describe('native v2 prepare', function () {
  it('reproduces the Payment_single signing hash', function () {
    const prepared = prepareTransactionV2(
      'payment',
      PAYMENT,
      {
        memo: {
          type: 'purpose/SALA',
          format: 'text/plain',
          data: 'invoice-0001'
        }
      }
    );
    expect(prepared.signingHash).to.equal(
      '0xba315765f290d96913ab216c29462b0fc02768bb568831d6fcc2a600fe45dc62'
    );
  });

  it('reproduces the Payment_single transaction hash', function () {
    const prepared = prepareTransactionV2(
      'payment',
      PAYMENT,
      {
        memo: {
          type: 'purpose/SALA',
          format: 'text/plain',
          data: 'invoice-0001'
        }
      }
    );
    const authorized = prepared.authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'bb'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(authorized.transactionHash).to.equal(
      '0xb6a28315164c84e89e57090639d20e2b0b94d0be7e13551e9630ae230eacf6d7'
    );
    expect(authorized.path).to.equal(
      '/v2/transactions/payment'
    );
  });

  it('always includes a complete memo in the request body', function () {
    const prepared = prepareTransactionV2(
      'payment',
      PAYMENT
    );
    const authorized = prepared.authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'bb'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(authorized.request.memo).to.deep.equal({
      type: '',
      format: '',
      data: ''
    });
  });

  it('emits a tagged authorization and no legacy signature', function () {
    const authorized = TransactionBuilderV2.payment(
      PAYMENT
    ).authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'bb'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(
      (authorized.request.authorization as { type: string }).type
    ).to.equal('single_secp256k1');
    expect(authorized.request.signature).to.equal(
      undefined
    );
    expect(
      authorized.request.operation_type
    ).to.equal(undefined);
  });

  it('gives blacklist and whitelist different signing hashes', function () {
    const unsigned = {
      chain_id: 1212101,
      nonce: 5,
      action: 'Add',
      address:
        '0x0606060606060606060606060606060606060606',
      token: TOKEN
    } as never;

    const blacklist = prepareTransactionV2(
      'tokenBlacklist',
      unsigned
    );
    const whitelist = prepareTransactionV2(
      'tokenWhitelist',
      unsigned
    );
    expect(blacklist.signingHash).to.not.equal(
      whitelist.signingHash
    );
  });

  it('is JSON-serializable end to end', function () {
    const authorized = TransactionBuilderV2.payment(
      PAYMENT
    ).authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'bb'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    const roundTripped = JSON.parse(
      JSON.stringify(authorized)
    );
    expect(roundTripped).to.deep.equal(authorized);
  });

  it('registers a v2 path for every operation', function () {
    Object.values(OPERATION_REGISTRY).forEach(
      spec => {
        expect(spec.pathV2).to.match(/^\/v2\//);
      }
    );
  });
});
