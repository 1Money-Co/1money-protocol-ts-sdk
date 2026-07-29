import { expect } from 'chai';
import 'mocha';

import { vectorHash } from './helpers/vectors';
import { batchPaymentPayloadFields } from '../../builders/batchPayment';
import {
  encodeRlpPayload,
  rlpValue as ev
} from '../../../utils';
import { prepareTransactionV2 } from '../prepare';

const CHAIN_ID = 1212101;
const TOKEN = `0x${'01'.repeat(20)}`;

const BASE = {
  chain_id: CHAIN_ID,
  nonce: 14,
  token: TOKEN,
  operations: [
    {
      recipient: `0x${'0c'.repeat(20)}`,
      amount: '1000'
    },
    {
      recipient: `0x${'0d'.repeat(20)}`,
      amount: '2000'
    }
  ],
  max_fee: '5000',
  created_at: 1747785600
};

describe('batch payment v2', function () {
  it('reproduces the BatchPayment_single signing hash', function () {
    expect(
      prepareTransactionV2('batchPayment', BASE)
        .signingHash
    ).to.equal(
      vectorHash('BatchPayment_single')
    );
  });

  it('omits both trailing optionals entirely', function () {
    const fields =
      batchPaymentPayloadFields(BASE);
    // token, operations, max_fee, created_at — chain_id and
    // nonce are prepended by the encoder.
    expect(fields).to.have.length(4);
  });

  it('encodes an absent operations_hash as a placeholder when batch_id is present', function () {
    const fields = batchPaymentPayloadFields({
      ...BASE,
      batch_id: 'batch-7'
    });
    expect(fields).to.have.length(6);
    const encoded = Array.from(
      encodeRlpPayload(fields[4])
    );
    expect(encoded).to.deep.equal([0x80]);
    expect(fields[5]).to.deep.equal(
      ev.string('batch-7')
    );
  });

  it('encodes a present operations_hash normally', function () {
    const hash = `0x${'ab'.repeat(32)}`;
    const fields = batchPaymentPayloadFields({
      ...BASE,
      operations_hash: hash
    });
    expect(fields).to.have.length(5);
    expect(fields[4]).to.deep.equal(
      ev.hex(hash as `0x${string}`)
    );
  });

  it('omits absent optionals from the JSON body', function () {
    const authorized = prepareTransactionV2(
      'batchPayment',
      BASE
    ).authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(
      'operations_hash' in authorized.request
    ).to.equal(false);
    expect(
      'batch_id' in authorized.request
    ).to.equal(false);
    expect('memo' in authorized.request).to.equal(
      false
    );
  });

  it('rejects a memo', function () {
    expect(() =>
      prepareTransactionV2(
        'batchPayment',
        BASE,
        { memo: { data: 'nope' } }
      )
    ).to.throw(/does not carry a memo/);
  });

  // Regression coverage for the round-2 finding: `rlpValue.string(null)`
  // encodes to the 4-byte string "null" (TextEncoder coerces `null` via
  // `String(null)`), so a `null` batch_id/operations_hash -- the normal
  // shape after a JSON or SQL round-trip -- silently corrupted the signed
  // digest instead of being treated as absent, like `undefined` already
  // is.
  describe('null batch_id / operations_hash (must behave exactly like absent)', function () {
    it('omits both trailing optionals from the payload fields when batch_id is null', function () {
      const fields = batchPaymentPayloadFields({
        ...BASE,
        batch_id: null as unknown as string
      });
      expect(fields).to.have.length(4);
    });

    it('omits both trailing optionals from the payload fields when operations_hash is null', function () {
      const fields = batchPaymentPayloadFields({
        ...BASE,
        operations_hash:
          null as unknown as string
      });
      expect(fields).to.have.length(4);
    });

    it('produces the same signing hash for null and absent batch_id', function () {
      const withNull = prepareTransactionV2(
        'batchPayment',
        {
          ...BASE,
          batch_id: null as unknown as string
        }
      ).signingHash;
      const absent = prepareTransactionV2(
        'batchPayment',
        BASE
      ).signingHash;
      expect(withNull).to.equal(absent);
    });

    it('omits batch_id and operations_hash from the wire body when null', function () {
      const authorized = prepareTransactionV2(
        'batchPayment',
        {
          ...BASE,
          batch_id: null as unknown as string,
          operations_hash:
            null as unknown as string
        }
      ).authorize({
        r: `0x${'aa'.repeat(32)}` as `0x${string}`,
        s: `0x${'11'.repeat(32)}` as `0x${string}`,
        v: 1
      });
      expect(
        'batch_id' in authorized.request
      ).to.equal(false);
      expect(
        'operations_hash' in authorized.request
      ).to.equal(false);
    });
  });

  describe('validateBatchPayment on genuinely present optionals', function () {
    it('accepts a present, well-formed batch_id and operations_hash', function () {
      expect(() =>
        prepareTransactionV2('batchPayment', {
          ...BASE,
          batch_id: 'batch-7',
          operations_hash: `0x${'ab'.repeat(32)}`
        })
      ).to.not.throw();
    });

    it('rejects a non-string batch_id', function () {
      expect(() =>
        prepareTransactionV2('batchPayment', {
          ...BASE,
          batch_id: 7 as unknown as string
        })
      ).to.throw(/Invalid batch_id/);
    });

    it('rejects a malformed operations_hash', function () {
      expect(() =>
        prepareTransactionV2('batchPayment', {
          ...BASE,
          operations_hash: '0xabcd'
        })
      ).to.throw(/Invalid operations_hash/);
    });
  });
});
