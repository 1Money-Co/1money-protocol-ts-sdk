import { expect } from 'chai';
import 'mocha';
import { hexToBytes, keccak256 } from 'viem';

import {
  batchVectors,
  parseBatchVectors,
  vector
} from './helpers/vectors';
import { readRawRlpItem } from './helpers/rawRlp';

const REQUIRED_TAIL_CASES = [
  'batch_option_neither',
  'batch_option_hash_only',
  'batch_option_id_only',
  'batch_option_both',
  'batch_option_empty_id',
  'batch_option_zero_hash'
] as const;

const REQUIRED_OPERATION_CASES = [
  'batch_operations_empty',
  'batch_operations_single',
  'batch_operations_order_forward',
  'batch_operations_order_reverse',
  'batch_operation_amount_zero',
  'batch_operation_amount_max'
] as const;

describe('Batch Payment fixture contract', function () {
  it('rejects malformed focused vector entries', function () {
    const [entry] = batchVectors();
    const malformed = {
      ...entry,
      payload: {
        ...entry.payload,
        created_at: 'not-a-number'
      }
    };

    expect(() =>
      parseBatchVectors({ vectors: [malformed] })
    ).to.throw(/payload.created_at/);
  });

  it('contains the complete focused Batch Payment oracle set', function () {
    const vectors = batchVectors();
    const names = new Set(vectors.map(entry => entry.name));

    [...REQUIRED_TAIL_CASES, ...REQUIRED_OPERATION_CASES].forEach(
      name => expect(names).to.include(name)
    );
    expect(
      vectors.some(entry => entry.options.memo?.data)
    ).to.equal(true);

    vectors.forEach(entry => {
      expect(entry.operation).to.equal('BatchPayment');
      expect(entry.operation_type).to.equal(14);
      expect(Object.keys(entry.payload).sort()).to.deep.equal(
        [
          'batch_id',
          'chain_id',
          'created_at',
          'nonce',
          'operations',
          'operations_hash',
          'token'
        ]
      );
      expect(entry.payload.chain_id).to.be.a('number');
      expect(entry.payload.nonce).to.be.a('number');
      expect(entry.payload.token).to.be.a('string');
      expect(entry.payload.created_at).to.be.a('number');
      expect(entry.payload.operations).to.be.an('array');
      entry.payload.operations.forEach(operation => {
        expect(Object.keys(operation).sort()).to.deep.equal(
          ['amount', 'recipient']
        );
        expect(operation.recipient).to.be.a('string');
        expect(operation.amount).to.be.a('string');
      });
      expect(entry.payload.operations_hash === null || typeof entry.payload.operations_hash === 'string').to.equal(true);
      expect(entry.payload.batch_id === null || typeof entry.payload.batch_id === 'string').to.equal(true);
      expect(Object.keys(entry.options)).to.satisfy(keys =>
        keys.length === 0 ||
        (keys.length === 1 && keys[0] === 'memo')
      );
      if (entry.options.memo) {
        expect(entry.options.memo).to.deep.have.all.keys(
          'type',
          'format',
          'data'
        );
        expect(entry.options.memo.type).to.be.a('string');
        expect(entry.options.memo.format).to.be.a('string');
        expect(entry.options.memo.data).to.be.a('string');
      }
      expect(entry.expected.signing_hash).to.match(
        /^0x[0-9a-f]{64}$/i
      );
      expect(entry.expected.transaction_hash).to.match(
        /^0x[0-9a-f]{64}$/i
      );
      expect(entry.expected.operations_hash).to.match(
        /^0x[0-9a-f]{64}$/i
      );
      expect(entry.authorization.v).to.be.oneOf([0, 1]);
      expect(entry.authorization.r).to.match(
        /^0x[0-9a-f]{64}$/i
      );
      expect(entry.authorization.s).to.match(
        /^0x[0-9a-f]{64}$/i
      );
      expect(
        BigInt(entry.authorization.s) <=
          BigInt(
            '0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0'
          )
      ).to.equal(true);
    });
  });
});

describe('raw Batch Payment operations oracle', function () {
  it('preserves the canonical operations child encoding', function () {
    const single = vector('BatchPayment_single');
    const multi = vector('BatchPayment_multi');
    const singlePayload = hexToBytes(
      single.payload_rlp as `0x${string}`
    );
    const multiPayload = hexToBytes(
      multi.payload_rlp as `0x${string}`
    );
    const withMemo = readRawRlpItem(singlePayload, 0);
    const inner = withMemo.children[0];
    const operations = inner.children[3];
    const raw = singlePayload.slice(
      operations.start,
      operations.end
    );

    expect(`0x${Buffer.from(raw).toString('hex')}`).to.equal(
      '0xf2d8940c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c8203e8d8940d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d8207d0'
    );
    expect(keccak256(raw)).to.equal(
      '0x5e2223ed47383af13d07e685fa659cb3409d0ce949ff34a3cd74b572c9d28656'
    );
    expect(
      multiPayload.slice(
        operations.start,
        operations.end
      )
    ).to.deep.equal(raw);
  });
});
