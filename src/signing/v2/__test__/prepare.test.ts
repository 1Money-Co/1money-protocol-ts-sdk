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
    // Not the Payment_single conformance vector's own dummy
    // signature (r=0xaa.., s=0xbb..) -- that s is high-S, and
    // authorize() now enforces low-S (see prepare.ts). Using a
    // low-S dummy here means this transactionHash is pinned to this
    // SDK's own output (a self-consistency/regression guard), not
    // cross-checked against the frozen vector fixture; the
    // conformance suite (conformance.test.ts) still exercises the
    // real vector directly against the low-level encoders.
    const authorized = prepared.authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(authorized.transactionHash).to.equal(
      '0xf6aedca96bc071df12a00d937507b47d45663f4495999b66526368bf9f39f3e5'
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
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(authorized.request.memo).to.deep.equal({
      type: '',
      format: '',
      data: ''
    });
  });

  it('returns an independent canonical memo from every authorization', function () {
    const memo = {
      type: 'purpose/SALA',
      format: 'text/plain',
      data: 'invoice-0001'
    };
    const signature = {
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    } as const;
    const prepared = prepareTransactionV2(
      'payment',
      PAYMENT,
      { memo }
    );
    const first = prepared.authorize(signature);

    (first.request.memo as typeof memo).data =
      'poisoned';

    const second = prepared.authorize(signature);
    const fresh = prepareTransactionV2(
      'payment',
      PAYMENT,
      { memo }
    );
    const expected = fresh.authorize(signature);

    expect(second.request.memo).to.deep.equal(memo);
    expect(second.request).to.deep.equal(
      expected.request
    );
    expect(prepared.signingHash).to.equal(
      fresh.signingHash
    );
    expect(second.transactionHash).to.equal(
      expected.transactionHash
    );
  });

  it('emits a tagged authorization and no legacy signature', function () {
    const authorized = TransactionBuilderV2.payment(
      PAYMENT
    ).authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
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
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    const roundTripped = JSON.parse(
      JSON.stringify(authorized)
    );
    expect(roundTripped).to.deep.equal(authorized);
  });

  it('snapshots nested unsigned data for signing and authorization', function () {
    const unsigned = {
      chain_id: 1212101,
      nonce: 1,
      token: TOKEN,
      operations: [
        {
          recipient: RECIPIENT,
          amount: '1000'
        }
      ],
      created_at: 1747785600
    };
    const prepared =
      TransactionBuilderV2.batchPayment(unsigned);

    unsigned.operations[0].amount = '9999';
    prepared.unsigned.operations[0].recipient =
      '0x0303030303030303030303030303030303030303';

    const authorized = prepared.authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(
      authorized.request.operations
    ).to.deep.equal([
      {
        recipient: RECIPIENT,
        amount: '1000'
      }
    ]);
  });

  it('registers a v2 path for every operation', function () {
    Object.values(OPERATION_REGISTRY).forEach(
      spec => {
        expect(spec.pathV2).to.match(/^\/v2\//);
      }
    );
  });

  it('rejects a high-S signature in authorize() (malleability guard)', function () {
    const prepared = prepareTransactionV2(
      'payment',
      PAYMENT
    );
    expect(() =>
      prepared.authorize({
        r: `0x${'aa'.repeat(32)}` as `0x${string}`,
        // Above secp256k1n/2 -- the same bound the legacy path
        // enforces in attachSignature (src/signing/core.ts).
        s: `0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF` as `0x${string}`,
        v: 1
      })
    ).to.throw(
      '[1Money SDK]: Invalid signature - high S value detected (potential malleability)'
    );
  });

  it('rejects an unsigned payload that carries a memo property', function () {
    const withMemo = {
      ...PAYMENT,
      memo: { type: '', format: '', data: 'sneaked-in' }
    } as unknown as typeof PAYMENT;

    expect(() =>
      prepareTransactionV2('payment', withMemo)
    ).to.throw(
      /payment unsigned payload must not include a memo property/
    );
  });

  it('snapshots Batch Payment memo passed through its builder wrapper', function () {
    const unsigned = {
      chain_id: 1212101,
      nonce: 1,
      token: TOKEN,
      operations: [
        {
          recipient: RECIPIENT,
          amount: '1000'
        }
      ],
      created_at: 1747785600
    };
    const memo = { data: 'invoice-1' };

    const prepared = TransactionBuilderV2.batchPayment(
      unsigned,
      { memo }
    );
    memo.data = 'mutated';
    const authorized = prepared.authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(authorized.request.memo).to.deep.equal({
      type: '',
      format: '',
      data: 'invoice-1'
    });
  });
});
