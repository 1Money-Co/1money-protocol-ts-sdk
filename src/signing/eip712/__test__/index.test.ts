import { expect } from 'chai';
import 'mocha';
import { hashTypedData, keccak256, toBytes } from 'viem';

import { MemoValidationError } from '@/utils';

import {
  buildPaymentEip712TypedData,
  parseSig,
  preparePaymentTypedTx,
  PAYMENT_KIND,
  SOL_MEMO_FIELDS,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  EIP712_VERIFYING_CONTRACT,
} from '../';

// Fixed cross-vector input shared with l1client `eip712_typed_tests.rs`.
// Same payment vector used by the RLP builder tests (signing/__test__/index.test.ts).
const PAYMENT_INPUT = {
  chain_id: 1212101,
  nonce: 0,
  recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
  value: '10',
  token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
  memo: {
    type: 'purpose/SALA',
    format: 'text/plain',
    data: 'invoice-001',
  },
} as const;

describe('eip712 typed-data module', function () {
  describe('parseSig', function () {
    const r = `0x${'aa'.repeat(32)}`;
    const s = `0x${'bb'.repeat(32)}`;

    it('keeps v=27 as 27', function () {
      const sig = parseSig(`${r}${s.slice(2)}1b`); // 0x1b = 27
      expect(sig.v).to.equal(27);
      expect(sig.r).to.equal(r);
      expect(sig.s).to.equal(s);
    });

    it('keeps v=28 as 28', function () {
      const sig = parseSig(`${r}${s.slice(2)}1c`); // 0x1c = 28
      expect(sig.v).to.equal(28);
    });

    it('normalizes v=0 to 27', function () {
      const sig = parseSig(`${r}${s.slice(2)}00`);
      expect(sig.v).to.equal(27);
    });

    it('normalizes v=1 to 28', function () {
      const sig = parseSig(`${r}${s.slice(2)}01`);
      expect(sig.v).to.equal(28);
    });

    it('throws on unexpected v byte (v=5)', function () {
      expect(() => parseSig(`${r}${s.slice(2)}05`)).to.throw(
        '[1Money SDK]'
      );
    });

    it('throws on 64-byte (non-65-byte) signature', function () {
      // 64 bytes = 128 hex chars, missing the v byte.
      expect(() => parseSig(`${r}${s.slice(2)}`)).to.throw(
        '[1Money SDK]'
      );
    });
  });

  describe('buildPaymentEip712TypedData', function () {
    it('builds the expected domain and primaryType', function () {
      const td = buildPaymentEip712TypedData(PAYMENT_INPUT);
      expect(td.primaryType).to.equal('PaymentV1');
      expect(td.domain.name).to.equal(EIP712_DOMAIN_NAME);
      expect(td.domain.version).to.equal(EIP712_DOMAIN_VERSION);
      expect(td.domain.chainId).to.equal(1212101);
      expect(td.domain.verifyingContract).to.equal(
        EIP712_VERIFYING_CONTRACT
      );
      expect(td.types.PaymentV1).to.equal(PAYMENT_KIND.eip712Fields);
      expect(td.types.SolMemo).to.equal(SOL_MEMO_FIELDS);
    });

    it('maps memo {type,format,data} to {memoType,memoFormat,memoData}', function () {
      const td = buildPaymentEip712TypedData(PAYMENT_INPUT);
      expect(td.message.memo).to.deep.equal({
        memoType: 'purpose/SALA',
        memoFormat: 'text/plain',
        memoData: 'invoice-001',
      });
      expect(td.message.chainId).to.equal(1212101);
      expect(td.message.nonce).to.equal(0);
      expect(td.message.recipient).to.equal(PAYMENT_INPUT.recipient);
      expect(td.message.value).to.equal('10');
      expect(td.message.token).to.equal(PAYMENT_INPUT.token);
    });

    it('maps missing memo to empty strings', function () {
      const td = buildPaymentEip712TypedData({
        chain_id: 1212101,
        nonce: 0,
        recipient: PAYMENT_INPUT.recipient,
        value: '10',
        token: PAYMENT_INPUT.token,
      });
      expect(td.message.memo).to.deep.equal({
        memoType: '',
        memoFormat: '',
        memoData: '',
      });
    });

    it('throws MemoValidationError on malformed memo', function () {
      expect(() =>
        buildPaymentEip712TypedData({
          chain_id: 1212101,
          nonce: 0,
          recipient: PAYMENT_INPUT.recipient,
          value: '10',
          token: PAYMENT_INPUT.token,
          memo: { type: 'has space' },
        })
      )
        .to.throw(MemoValidationError)
        .with.property('code', 'MEMO_TYPE_INVALID_CHARS');
    });
  });

  describe('cross-vector pins (frozen l1client schema)', function () {
    // The frozen EIP-712 type string from l1client `eip712_typed.rs`.
    // hashType(PaymentV1) MUST equal this constant. Computed independently
    // via viem from the frozen schema — do NOT change to match output.
    const FROZEN_TYPE_STRING =
      'PaymentV1(uint64 chainId,uint64 nonce,address recipient,uint256 value,address token,SolMemo memo)SolMemo(string memoType,string memoFormat,string memoData)';
    const FROZEN_TYPE_HASH =
      '0xb36d85a5d7a04bc9be40abb2ec6bd28d45eb989451a1e25254517e349cac7afb';

    it('keccak256 of frozen PaymentV1 type string matches l1client', function () {
      expect(keccak256(toBytes(FROZEN_TYPE_STRING))).to.equal(
        FROZEN_TYPE_HASH
      );
    });

    it('PAYMENT_KIND registry fields reproduce the frozen type string', function () {
      // Build the EIP-712 type string from the registry definition and
      // assert it reproduces the frozen l1client hash. Guards against any
      // drift in field names/types/order in registry.ts.
      const paymentTypeStr =
        `${PAYMENT_KIND.primaryType}(` +
        PAYMENT_KIND.eip712Fields
          .map((f) => `${f.type} ${f.name}`)
          .join(',') +
        ')';
      const memoTypeStr =
        'SolMemo(' +
        SOL_MEMO_FIELDS.map((f) => `${f.type} ${f.name}`).join(',') +
        ')';
      // PaymentV1 references SolMemo, so the referenced type is appended
      // (sorted by name — only one referenced type here).
      const builtTypeString = `${paymentTypeStr}${memoTypeStr}`;
      expect(builtTypeString).to.equal(FROZEN_TYPE_STRING);
      expect(keccak256(toBytes(builtTypeString))).to.equal(
        FROZEN_TYPE_HASH
      );
    });

    it('hashTypedData of the payment vector matches l1client digest', function () {
      const td = buildPaymentEip712TypedData(PAYMENT_INPUT);
      const digest = hashTypedData({
        domain: td.domain,
        types: { PaymentV1: td.types.PaymentV1, SolMemo: td.types.SolMemo },
        primaryType: 'PaymentV1',
        message: td.message,
      });
      expect(digest).to.equal(
        '0x0a7f8d7d505fcd64c7437ca135582604e868d1be231c90defba8baadb0c8498e'
      );
    });

    it('encodeCalldata produces the frozen submitTypedData selector and tx shape', function () {
      // Selector and calldata shape pinned against l1client
      // `submit_typed_data_selector_is_frozen` and
      // `eip712_typed_tests.rs::build_raw`.
      const prepared = preparePaymentTypedTx(PAYMENT_INPUT);
      const tx = prepared.encodeCalldata({
        v: 28,
        r: `0x${'aa'.repeat(32)}`,
        s: `0x${'bb'.repeat(32)}`,
      });
      expect(tx.data.slice(0, 10)).to.equal('0x162d43c9');
      expect(tx.to).to.equal(PAYMENT_INPUT.token);
      expect(tx.value).to.equal(0n);
      expect(tx.gas).to.equal(21000n);
      expect(tx.gasPrice).to.equal(0n);
      expect(tx.type).to.equal('legacy');
    });

    it('encodeCalldata rejects v values that are not 27/28', function () {
      const prepared = preparePaymentTypedTx(PAYMENT_INPUT);
      expect(() =>
        prepared.encodeCalldata({
          v: 1 as unknown as 27 | 28,
          r: `0x${'aa'.repeat(32)}`,
          s: `0x${'bb'.repeat(32)}`,
        })
      ).to.throw('[1Money SDK]');
    });

    it('preparePaymentTypedTx exposes kind and primaryType', function () {
      const prepared = preparePaymentTypedTx(PAYMENT_INPUT);
      expect(prepared.kind).to.equal('TransferV1');
      expect(prepared.primaryType).to.equal('PaymentV1');
    });
  });
});
