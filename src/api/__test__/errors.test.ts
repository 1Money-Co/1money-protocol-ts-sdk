import { expect } from 'chai';
import 'mocha';

import {
  assertTransactionHash,
  isLegacyWriteDisabled,
  isNativeV2NotActive,
  TransactionHashMismatchError,
  TransactionLockedError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError,
  V2_ERROR_CODES
} from '../errors';

const LOCAL = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;

describe('v2 errors', function () {
  it('exposes the five v2 error codes', function () {
    expect(
      Object.values(V2_ERROR_CODES)
    ).to.have.members([
      'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE',
      'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED',
      'UNSUPPORTED_AUTHORIZATION_TYPE',
      'DOMAIN_SEPARATED_SIGNATURE_REQUIRED',
      'RAW_TRANSACTION_ENDPOINT_REMOVED'
    ]);
  });

  it('narrows a not-active rejection', function () {
    expect(
      isNativeV2NotActive({
        status: 403,
        data: {
          error_code:
            'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE'
        }
      })
    ).to.equal(true);
    expect(isNativeV2NotActive({})).to.equal(
      false
    );
    expect(
      isNativeV2NotActive(undefined)
    ).to.equal(false);
  });

  it('narrows a legacy-disabled rejection', function () {
    expect(
      isLegacyWriteDisabled({
        status: 410,
        data: {
          error_code:
            'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED'
        }
      })
    ).to.equal(true);
  });

  it('accepts a matching hash regardless of case', function () {
    expect(() =>
      assertTransactionHash(
        LOCAL,
        LOCAL.toUpperCase()
      )
    ).to.not.throw();
  });

  it(
    'throws a submitted-flagged error on mismatch',
    function () {
      let caught: unknown;
      try {
        assertTransactionHash(LOCAL, OTHER);
      } catch (error) {
        caught = error;
      }
      expect(caught).to.be.instanceOf(
        TransactionHashMismatchError
      );
      const err =
        caught as TransactionHashMismatchError;
      expect(err.submitted).to.equal(true);
      expect(err.localHash).to.equal(LOCAL);
      expect(err.serverHash).to.equal(OTHER);
    }
  );

  // Fail-closed: a malformed serverHash must never
  // escape as a bare TypeError. The tx was already
  // admitted, so this must still surface as
  // TransactionHashMismatchError with
  // submitted === true.
  for (const bad of [
    undefined,
    null,
    12345
  ] as unknown[]) {
    it(
      `throws TransactionHashMismatchError (submitted: true) for serverHash ${String(bad)}`,
      function () {
        let caught: unknown;
        try {
          assertTransactionHash(LOCAL, bad);
        } catch (error) {
          caught = error;
        }
        expect(caught).to.be.instanceOf(
          TransactionHashMismatchError
        );
        const err =
          caught as TransactionHashMismatchError;
        expect(err.submitted).to.equal(true);
      }
    );
  }
});

describe('problem details on the write errors', function () {
  const TYPE =
    'https://developer.1moneynetwork.com/problem/insufficient_balance';
  const INSTANCE =
    'urn:uuid:0192f0c4-7d2e-7a51-9b0e-3c1d2e4f5a6b';
  const body = {
    type: TYPE,
    title: 'Insufficient balance',
    status: 422,
    instance: INSTANCE,
    action: 'fix_request',
    tx_hash: LOCAL,
    error_code: 'business_transaction_failed',
    message: 'insufficient balance'
  };

  it('exposes the parsed problem of the body on each error', function () {
    const errors = [
      new TransactionSubmissionError(422, body, 'refused', {
        action: 'fix_request',
        problemType: TYPE
      }),
      new TransactionLockedError(LOCAL, {
        status: 422,
        data: body,
        problemType: TYPE
      }),
      new TransactionOutcomeUnknownError(LOCAL, {
        status: 422,
        data: body,
        action: 'fix_request',
        problemType: TYPE
      })
    ];
    for (const err of errors) {
      expect(err.problem?.type).to.equal(TYPE);
      expect(err.problem?.instance).to.equal(INSTANCE);
      expect(err.problem?.action).to.equal('fix_request');
      expect(err.problem?.txHash).to.equal(LOCAL);
      expect(err.problem?.members).to.deep.equal({
        tx_hash: LOCAL
      });
    }
  });

  it('has no problem when the body has none', function () {
    const legacy = {
      error_code: 'business_transaction_failed',
      message: 'refused'
    };
    expect(
      new TransactionSubmissionError(422, legacy, 'refused')
        .problem
    ).to.equal(undefined);
    expect(
      new TransactionLockedError(LOCAL).problem
    ).to.equal(undefined);
    expect(
      new TransactionOutcomeUnknownError(LOCAL, {
        status: 500
      }).problem
    ).to.equal(undefined);
  });
});
