import { expect } from 'chai';
import 'mocha';
import { hexToBytes } from 'viem';

import {
  calculateBatchPaymentOperationsHash,
  type BatchPaymentUnsigned
} from '@/signing';
import {
  encodeRlpPayload,
  rlpValue as ev
} from '@/utils';
import {
  batchPaymentPayloadFields,
  type BatchPaymentUnsigned as BuilderBatchPaymentUnsigned
} from '../../builders/batchPayment';
import {
  encodePayloadRlp,
  multisigDescriptor,
  multisigProof,
  signingHashV2,
  singleDescriptor,
  singleProof,
  transactionHashV2
} from '../encoding';
import { prepareTransactionV2 } from '../prepare';
import { toRequiredMemo } from '../wire';
import {
  batchVector,
  vector
} from './helpers/vectors';

const U256_MAX =
  (BigInt(1) << BigInt(256)) - BigInt(1);
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const LOW_S_SIGNATURE = {
  r: `0x${'aa'.repeat(32)}` as `0x${string}`,
  s: `0x${'11'.repeat(32)}` as `0x${string}`,
  v: 1
};
const REQUIRED_OPERATION_CASES = [
  'batch_operations_empty',
  'batch_operations_single',
  'batch_operations_order_forward',
  'batch_operations_order_reverse',
  'batch_operation_amount_zero',
  'batch_operation_amount_max'
] as const;
const REQUIRED_TAIL_CASES = [
  'batch_option_neither',
  'batch_option_hash_only',
  'batch_option_id_only',
  'batch_option_both',
  'batch_option_empty_id',
  'batch_option_zero_hash'
] as const;

const BASE = batchVector(
  'BatchPayment_canonical'
).payload as unknown as BatchPaymentUnsigned;

function payloadFor(name: string): BatchPaymentUnsigned {
  return batchVector(name).payload as unknown as BatchPaymentUnsigned;
}

function lowLevelHashes(name: string) {
  const entry = batchVector(name);
  const payloadRlp = encodePayloadRlp({
    chainId: entry.payload.chain_id,
    nonce: entry.payload.nonce,
    payloadFields: batchPaymentPayloadFields(
      entry.payload as unknown as BuilderBatchPaymentUnsigned
    ),
    memo: toRequiredMemo(entry.options.memo)
  });
  const descriptor = singleDescriptor();
  return {
    signingHash: signingHashV2(
      14,
      descriptor,
      payloadRlp
    ),
    transactionHash: transactionHashV2(
      14,
      descriptor,
      payloadRlp,
      singleProof(entry.authorization)
    )
  };
}

describe('batch payment v2', function () {
  it('reproduces the base single signing and transaction hashes', function () {
    const entry = batchVector('BatchPayment_canonical');
    const prepared = prepareTransactionV2(
      'batchPayment',
      BASE
    );
    expect(prepared.signingHash).to.equal(
      entry.expected.signing_hash
    );
    expect(
      prepared.authorize(entry.authorization).transactionHash
    ).to.equal(entry.expected.transaction_hash);
  });

  it('reproduces the base multisig signing and transaction hashes', function () {
    const multi = vector('BatchPayment_multi');
    if (multi.multisig_account === null) {
      throw new Error(
        '[test]: BatchPayment_multi is missing multisig_account'
      );
    }
    const multiPayloadRlp = hexToBytes(
      multi.payload_rlp as `0x${string}`
    );
    const multiDescriptor = multisigDescriptor(
      multi.multisig_account as `0x${string}`
    );
    const multiEntries = multi.authorization_proof.signatures!.map(
      entry => ({
        signerPubkey: entry.signer_pubkey as `0x${string}`,
        signature: entry.signature
      })
    );
    expect(
      signingHashV2(
        multi.operation_type,
        multiDescriptor,
        multiPayloadRlp
      )
    ).to.equal(multi.signing_hash);
    expect(
      transactionHashV2(
        multi.operation_type,
        multiDescriptor,
        multiPayloadRlp,
        multisigProof(multiEntries)
      )
    ).to.equal(multi.transaction_hash);
  });

  it('always includes an empty memo and no max_fee on the request', function () {
    const authorized = prepareTransactionV2(
      'batchPayment',
      BASE
    ).authorize(LOW_S_SIGNATURE);
    expect(authorized.request.memo).to.deep.equal({
      type: '',
      format: '',
      data: ''
    });
    expect('max_fee' in authorized.request).to.equal(false);
  });

  it('projects exact operation fields without changing canonical hashes', function () {
    const operation = {
      ...BASE.operations[0],
      unsigned_only: 'must-not-reach-wire'
    };
    Object.defineProperty(operation, 'hidden', {
      value: 'also-must-not-reach-wire',
      enumerable: false
    });
    const withExtras = {
      ...BASE,
      operations: [operation, ...BASE.operations.slice(1)]
    } as unknown as BatchPaymentUnsigned;
    const prepared = prepareTransactionV2(
      'batchPayment',
      withExtras
    );
    const canonical = prepareTransactionV2(
      'batchPayment',
      BASE
    );
    const authorized = prepared.authorize(LOW_S_SIGNATURE);
    const expected = canonical.authorize(LOW_S_SIGNATURE);
    const wireOperation = (
      authorized.request.operations as Array<
        Record<string, unknown>
      >
    )[0];

    expect(prepared.signingHash).to.equal(
      canonical.signingHash
    );
    expect(authorized.transactionHash).to.equal(
      expected.transactionHash
    );
    expect(Object.keys(wireOperation).sort()).to.deep.equal([
      'amount',
      'recipient'
    ]);
    expect('unsigned_only' in wireOperation).to.equal(false);
    expect('hidden' in wireOperation).to.equal(false);
  });

  it('uses the focused populated-memo hashes', function () {
    const entry = batchVector('batch_option_neither_memo');
    const prepared = prepareTransactionV2(
      'batchPayment',
      payloadFor(entry.name),
      { memo: entry.options.memo }
    );
    expect(prepared.signingHash).to.equal(
      entry.expected.signing_hash
    );
    expect(
      prepared.authorize(entry.authorization).transactionHash
    ).to.equal(entry.expected.transaction_hash);
  });

  it('has five inner fields when tails are absent', function () {
    const fields = batchPaymentPayloadFields(BASE);
    expect(fields).to.have.length(3);
    expect(
      encodeRlpPayload(
        ev.list([
          ev.uint(BASE.chain_id),
          ev.uint(BASE.nonce),
          ...fields
        ])
      )
    ).to.be.instanceOf(Uint8Array);
  });

  it('uses an empty hash slot for batch_id-only tails', function () {
    const fields = batchPaymentPayloadFields(
      payloadFor('batch_option_id_only')
    );
    expect(fields).to.have.length(5);
    expect(encodeRlpPayload(fields[3])).to.deep.equal(
      Uint8Array.from([0x80])
    );
    expect(fields[4]).to.deep.equal(ev.string('batch-1'));
  });

  REQUIRED_TAIL_CASES.forEach(name => {
    it(`reproduces focused tail hashes for ${name}`, function () {
      const entry = batchVector(name);
      expect(lowLevelHashes(name).signingHash).to.equal(
        entry.expected.signing_hash
      );
      expect(lowLevelHashes(name).transactionHash).to.equal(
        entry.expected.transaction_hash
      );
    });
  });

  it('treats runtime null optionals like absent tails', function () {
    const absent = prepareTransactionV2(
      'batchPayment',
      BASE
    ).signingHash;
    const withNull = prepareTransactionV2('batchPayment', {
      ...BASE,
      operations_hash: null as unknown as `0x${string}`,
      batch_id: null as unknown as string
    }).signingHash;
    expect(withNull).to.equal(absent);
  });

  it('snapshots caller operations and memo before authorization', function () {
    const operations = BASE.operations.map(operation => ({
      ...operation
    }));
    const memo = { data: 'invoice-1' };
    const prepared = prepareTransactionV2(
      'batchPayment',
      { ...BASE, operations },
      { memo }
    );
    operations[0].amount = '9999';
    memo.data = 'mutated';
    const authorized = prepared.authorize(LOW_S_SIGNATURE);
    expect(authorized.request.operations).to.deep.equal(
      BASE.operations
    );
    expect(authorized.request.memo).to.deep.equal({
      type: '',
      format: '',
      data: 'invoice-1'
    });
  });
});

describe('Batch Payment operations hash', function () {
  REQUIRED_OPERATION_CASES.forEach(name => {
    it(`matches the oracle for ${name}`, function () {
      const entry = batchVector(name);
      expect(
        calculateBatchPaymentOperationsHash(
          entry.payload.operations
        )
      ).to.equal(entry.expected.operations_hash);
    });
  });

  it('accepts empty operations and zero amounts in the pure helper', function () {
    expect(() =>
      calculateBatchPaymentOperationsHash([])
    ).to.not.throw();
    expect(() =>
      calculateBatchPaymentOperationsHash([
        { recipient: ZERO_ADDRESS, amount: '0' }
      ])
    ).to.not.throw();
  });
});

describe('Batch Payment static validation', function () {
  it('rejects empty operations', function () {
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations: []
      })
    ).to.throw(/operations: must not be empty/);
  });

  it('rejects a zero recipient', function () {
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations: [{ recipient: ZERO_ADDRESS, amount: '1' }]
      })
    ).to.throw(/recipient: zero address/);
  });

  it('rejects a zero amount', function () {
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations: [{
          recipient: BASE.operations[0].recipient,
          amount: '0'
        }]
      })
    ).to.throw(/amount: must be greater than zero/);
  });

  it('rejects an amount above U256::MAX', function () {
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations: [{
          recipient: BASE.operations[0].recipient,
          amount: (U256_MAX + BigInt(1)).toString()
        }]
      })
    ).to.throw(/amount: exceeds U256::MAX/);
  });

  it('rejects an aggregate above U256::MAX', function () {
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations: [
          {
            recipient: BASE.operations[0].recipient,
            amount: U256_MAX.toString()
          },
          {
            recipient: BASE.operations[1].recipient,
            amount: '1'
          }
        ]
      })
    ).to.throw(/operations: total exceeds U256::MAX/);
  });

  it('accepts a matching supplied operations hash', function () {
    const operations_hash =
      calculateBatchPaymentOperationsHash(BASE.operations);
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations_hash
      })
    ).to.not.throw();
  });

  it('reports supplied and canonical values for a mismatch', function () {
    const supplied = `0x${'11'.repeat(32)}`;
    const canonical = calculateBatchPaymentOperationsHash(
      BASE.operations
    );
    expect(() =>
      prepareTransactionV2('batchPayment', {
        ...BASE,
        operations_hash: supplied
      })
    ).to.throw(`supplied ${supplied}, canonical ${canonical}`);
  });

  it('rejects legacy max_fee from untyped callers', function () {
    expect(() =>
      prepareTransactionV2(
        'batchPayment',
        { ...BASE, max_fee: '1' } as unknown as BatchPaymentUnsigned
      )
    ).to.throw(
      'Batch Payment no longer accepts max_fee; call estimateBatchPaymentFee() for an unsigned quote'
    );
  });

  it('rejects a non-enumerable legacy max_fee from untyped callers', function () {
    const unsigned = { ...BASE } as Record<
      string,
      unknown
    >;
    Object.defineProperty(unsigned, 'max_fee', {
      value: '1',
      enumerable: false
    });

    expect(() =>
      prepareTransactionV2(
        'batchPayment',
        unsigned as BatchPaymentUnsigned
      )
    ).to.throw(
      'Batch Payment no longer accepts max_fee; call estimateBatchPaymentFee() for an unsigned quote'
    );
  });
});
